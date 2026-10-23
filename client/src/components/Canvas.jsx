import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Copy strokes before storing them in the canvas. The server object must not be
// the same array we push points into while the next packet is still being read.
function cloneStrokes(strokes) {
  return (strokes || []).map((stroke) => ({
    color: stroke.color,
    size: stroke.size,
    points: (stroke.points || []).map((point) => ({ x: point.x, y: point.y })),
  }));
}

// What: paint one stroke in CSS pixels.
// Why: `size` is a fraction of the width, so a thick brush stays thick when the
// canvas is resized. A single point would otherwise be invisible, so we nudge it
// into a tiny line. Coordinates are 0–1 and get multiplied by this canvas's size.
function drawStroke(ctx, stroke, width, height) {
  if (!stroke.points.length) return;
  ctx.beginPath();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(1.25, stroke.size * width);
  stroke.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    ctx.lineTo(point.x * width + 0.01, point.y * height);
  }
  ctx.stroke();
}

// The canvas owns pixels and pointer events. It does not know whose turn it is.
// `interactive` is the only permission it gets. Strokes live in a ref, not React
// state, because a point every 30ms would re-render the lobby, chat, and score list.
const Canvas = forwardRef(function Canvas({ interactive, color, size, onDraw }, ref) {
  const canvasRef = useRef(null);
  const strokesRef = useRef([]);
  const drawingRef = useRef(false);
  const lastSent = useRef(0);
  const viewRef = useRef({ width: 300, height: 190, dpr: 1 });
  const onDrawRef = useRef(onDraw);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const interactiveRef = useRef(interactive);
  onDrawRef.current = onDraw;
  colorRef.current = color;
  sizeRef.current = size;
  interactiveRef.current = interactive;

  // What: repaint every stroke from scratch.
  // Why: undo and clear are easy if the bitmap is never the source of truth.
  // devicePixelRatio keeps the line sharp on retina screens without changing the 0–1 math.
  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { width, height, dpr } = viewRef.current;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke, width, height);
  }

  // What: pointer position as a fraction of the canvas, not of the window.
  // Why: the server stores 0–1. A phone and a laptop can replay the same stroke.
  function localPoint(event) {
    const rect = canvasRef.current.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / height)),
    };
  }

  // Always send the last point, even if the 32ms throttle skipped it.
  // Otherwise a fast flick ends short of where the pointer was released.
  function finishStroke(point) {
    if (!drawingRef.current) return;
    const stroke = strokesRef.current.at(-1);
    const last = stroke?.points.at(-1);
    if (point && stroke && (!last || last.x !== point.x || last.y !== point.y)) {
      stroke.points.push(point);
      onDrawRef.current({ type: 'move', x: point.x, y: point.y });
    }
    drawingRef.current = false;
    redraw();
    onDrawRef.current({ type: 'end' });
  }

  useImperativeHandle(ref, () => ({
    load(strokes) {
      drawingRef.current = false;
      strokesRef.current = cloneStrokes(strokes);
      redraw();
    },
    apply(event) {
      if (event.type === 'start') {
        strokesRef.current.push({
          color: event.color,
          size: event.size,
          points: [{ x: event.x, y: event.y }],
        });
      } else if (event.type === 'move') {
        strokesRef.current.at(-1)?.points.push({ x: event.x, y: event.y });
      } else if (event.type === 'undo') {
        strokesRef.current.pop();
      } else if (event.type === 'clear') {
        strokesRef.current = [];
      }
      redraw();
    },
    undo() {
      if (!strokesRef.current.length) return;
      drawingRef.current = false;
      strokesRef.current.pop();
      redraw();
      onDrawRef.current({ type: 'undo' });
    },
    clear() {
      if (!strokesRef.current.length) return;
      if (!window.confirm('Clear the whole canvas?')) return;
      drawingRef.current = false;
      strokesRef.current = [];
      redraw();
      onDrawRef.current({ type: 'clear' });
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas.parentElement;

    function resize() {
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      viewRef.current = { width, height, dpr };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      redraw();
    }

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    function onDown(event) {
      if (!interactiveRef.current || event.button > 0) return;
      const point = localPoint(event);
      canvas.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      lastSent.current = performance.now();
      strokesRef.current.push({
        color: colorRef.current,
        size: sizeRef.current,
        points: [point],
      });
      redraw();
      onDrawRef.current({
        type: 'start',
        x: point.x,
        y: point.y,
        color: colorRef.current,
        size: sizeRef.current,
      });
    }

    function onMove(event) {
      if (!drawingRef.current) return;
      const now = performance.now();
      // About 30fps. The drawer still feels immediate because we draw this point locally,
      // and we only skip sending the in-between samples. pointerup always sends the last one.
      if (now - lastSent.current < 32) return;
      lastSent.current = now;
      const point = localPoint(event);
      strokesRef.current.at(-1)?.points.push(point);
      redraw();
      onDrawRef.current({ type: 'move', x: point.x, y: point.y });
    }

    function onUp(event) {
      if (!drawingRef.current) return;
      finishStroke(localPoint(event));
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  useEffect(() => {
    if (!interactive) finishStroke(null);
  }, [interactive]);

  return (
    <canvas
      ref={canvasRef}
      className={interactive ? 'drawable' : ''}
      aria-label="Drawing canvas"
    />
  );
});

export default Canvas;
