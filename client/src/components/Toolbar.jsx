import { COLORS, SIZES } from '../constants.js';

// Drawer-only tools. The parent decides whether to render this at all.
// Colors and sizes are the same constants the server will accept.
export default function Toolbar({ color, size, onColor, onSize, onUndo, onClear }) {
  return (
    <div className="toolbar">
      <div className="swatches">
        {COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            className={swatch === color ? 'swatch on' : 'swatch'}
            style={{ background: swatch }}
            aria-label={swatch}
            aria-pressed={swatch === color}
            onClick={() => onColor(swatch)}
          />
        ))}
      </div>
      <div className="sizes">
        {SIZES.map((brush) => (
          <button
            key={brush.id}
            type="button"
            className={brush.width === size ? 'size on' : 'size'}
            aria-pressed={brush.width === size}
            onClick={() => onSize(brush.width)}
          >
            {brush.label}
          </button>
        ))}
      </div>
      <button type="button" className="ghost" onClick={onUndo}>Undo</button>
      <button type="button" className="ghost danger" onClick={onClear}>Clear</button>
    </div>
  );
}
