// What: the only colors and widths the server will store.
// Why: a client could send a 200px brush or a CSS expression. Snapping to
// this list keeps every screen drawing the same stroke the drawer intended.
export const PALETTE = [
  '#1a1a1a',
  '#ffffff',
  '#e11d48',
  '#f97316',
  '#eab308',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#92400e',
  '#64748b',
];

// Fractions of the canvas width, not pixels. A "thick" line stays thick
// on a phone and on a desktop because both sides multiply by their own width.
export const BRUSH_SIZES = [0.006, 0.014, 0.028];

// What: keep a coordinate inside the canvas.
// Why: points are 0–1 so different window sizes line up. NaN or 4 would
// throw the line off the bitmap or draw nothing useful.
export function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

// What: accept a palette color, otherwise fall back to ink.
// Why: the drawer picks from the same list the server knows. Anything else
// is treated as a mistake, not as a custom color.
export function sanitizeColor(value) {
  const color = String(value || '').toLowerCase();
  return PALETTE.includes(color) ? color : PALETTE[0];
}

// What: snap a requested width to the nearest allowed size.
// Why: floating point from the client may be 0.0140000001. Nearest-match
// still lands on medium instead of rejecting the stroke.
export function sanitizeSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return BRUSH_SIZES[1];
  return BRUSH_SIZES.reduce((best, size) => (
    Math.abs(size - number) < Math.abs(best - number) ? size : best
  ));
}
