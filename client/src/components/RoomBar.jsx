// Shared header for the lobby and the game. Leave is always available.
// The children slot is the clock during a match and the player count in the lobby.
export default function RoomBar({ roomId, onLeave, children }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        Scribble
      </div>
      <p className="room-code">Room <strong>{roomId}</strong></p>
      <div className="top-meta">{children}</div>
      <button type="button" className="ghost" onClick={onLeave}>Leave</button>
    </header>
  );
}
