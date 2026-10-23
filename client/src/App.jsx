import { useRoom } from './hooks/useRoom.js';
import Game from './screens/Game.jsx';
import Home from './screens/Home.jsx';
import Lobby from './screens/Lobby.jsx';

// What: pick the screen from the server phase.
// Why: there is no client-side router. The server says whether we are in the lobby
// or in a match, and a missing room id means we are still on the home form.
export default function App() {
  const room = useRoom();
  let screen = <Home room={room} />;
  if (room.booting && !room.roomId) {
    screen = (
      <main className="home">
        <p className="rejoining">Rejoining your room…</p>
      </main>
    );
  } else if (room.roomId && room.phase === 'lobby') {
    screen = <Lobby room={room} />;
  } else if (room.roomId) {
    screen = <Game room={room} />;
  }

  return (
    <>
      {room.error && (
        <button type="button" className="toast" onClick={room.clearError}>
          {room.error}
        </button>
      )}
      {screen}
    </>
  );
}
