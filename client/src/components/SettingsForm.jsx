export const FIELDS = [
  ['maxPlayers', 'Players', 2, 20],
  ['rounds', 'Rounds', 2, 10],
  ['drawTime', 'Draw time (seconds)', 15, 240],
  ['wordCount', 'Word choices', 1, 5],
  ['hints', 'Hints (0 is off)', 0, 5],
];

// The same fields are used on the home screen (local state) and in the lobby (server state).
// Min and max match the server clamps. The server still wins if these are bypassed.
// `invalid` is a list of keys the parent found out of range, so they can be marked.
export default function SettingsForm({ settings, onChange, disabled, invalid = [] }) {
  function update(key, value) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="settings">
      {FIELDS.map(([key, label, min, max]) => (
        <label key={key}>
          <span>{label}</span>
          <input
            type="number"
            min={min}
            max={max}
            value={settings[key] === '' ? '' : settings[key]}
            disabled={disabled}
            aria-invalid={invalid.includes(key) || undefined}
            className={invalid.includes(key) ? 'invalid' : undefined}
            // Keep an emptied field as '' so it can be reported. Number('') would turn it into 0.
            onChange={(event) => update(
              key,
              event.target.value === '' ? '' : Number(event.target.value),
            )}
          />
        </label>
      ))}
      <label className="check">
        <input
          type="checkbox"
          checked={settings.listed !== false}
          disabled={disabled}
          onChange={(event) => update('listed', event.target.checked)}
        />
        <span>List in Browse rooms</span>
      </label>
    </div>
  );
}
