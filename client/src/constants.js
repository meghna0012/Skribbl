// Defaults match server/src/logic/settings.js. The server clamps anyway.
// COLORS and SIZES must stay in sync with server/src/logic/draw.js or a chosen
// color would be snapped to black on the way through the server.
export const DEFAULT_SETTINGS = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 80,
  wordCount: 3,
  hints: 2,
  listed: true,
};

export const COLORS = [
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

// The eraser paints in the canvas background. The board is always opaque white, so
// a white stroke looks erased, undoes like any stroke, and replays for late joiners
// with no new event or server rule. Must be in COLORS so the server keeps it.
export const ERASER_COLOR = '#ffffff';

export const SIZES = [
  { id: 's', label: 'S', width: 0.006 },
  { id: 'm', label: 'M', width: 0.014 },
  { id: 'l', label: 'L', width: 0.028 },
];
