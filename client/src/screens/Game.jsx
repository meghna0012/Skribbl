import { useEffect, useRef, useState } from 'react';
import Canvas from '../components/Canvas.jsx';
import Chat from '../components/Chat.jsx';
import HintBar from '../components/HintBar.jsx';
import PlayerList from '../components/PlayerList.jsx';
import RoomBar from '../components/RoomBar.jsx';
import RoundOverlay from '../components/RoundOverlay.jsx';
import Toolbar from '../components/Toolbar.jsx';
import WordChoice from '../components/WordChoice.jsx';
import { COLORS, SIZES } from '../constants.js';
import { formatTime } from '../format.js';

// What: one layout for choosing, drawing, the round reveal, and the final scores.
// Why: swapping entire pages on each phase would remount the canvas and lose the
// picture. Overlays sit on top of the same canvas instead.
// The guess box says "Type your guess" only while this player can still score.
// Otherwise it is chat, including while someone is still choosing a word.
export default function Game({ room }) {
  const canvasRef = useRef(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1].width);
  const guessed = room.game?.guessedIds?.includes(room.playerId);
  const canDraw = room.isDrawer && room.phase === 'drawing' && !room.game?.paused;
  const drawer = room.players.find((player) => player.id === room.game?.drawerId);
  const placeholder = room.phase === 'drawing' && !canDraw && !guessed
    ? 'Type your guess'
    : 'Chat';

  // Apply server stroke commands here, not inside the canvas's own pointer path.
  // The drawer paints locally and does not receive their own draw_data.
  useEffect(() => {
    const command = room.canvasCmd;
    if (!command || !canvasRef.current) return;
    if (command.type === 'load') canvasRef.current.load(command.strokes);
    else canvasRef.current.apply(command);
  }, [room.canvasCmd]);

  return (
    <div className="shell">
      <RoomBar roomId={room.roomId} onLeave={room.leaveRoom}>
        <span>
          Round {room.game?.round || 1} of {room.game?.totalRounds || room.settings?.rounds || 1}
        </span>
        <span className="clock">{formatTime(room.game?.timeLeft)}</span>
      </RoomBar>
      <div className="stage">
        <PlayerList
          players={room.players}
          playerId={room.playerId}
          hostId={room.hostId}
          drawerId={room.game?.drawerId}
          guessedIds={room.game?.guessedIds || []}
          phase={room.phase}
        />
        <section className="board">
          <HintBar
            phase={room.phase}
            isDrawer={room.isDrawer}
            drawerName={drawer?.name || 'Someone'}
            mask={room.game?.mask}
            yourWord={room.yourWord}
            guessed={Boolean(guessed)}
            paused={Boolean(room.game?.paused)}
          />
          <div className="canvas-wrap">
            <Canvas
              ref={canvasRef}
              interactive={canDraw}
              color={color}
              size={size}
              onDraw={room.emitDraw}
            />
            {room.phase === 'choosing' && room.isDrawer && room.wordOptions.length > 0 && (
              <WordChoice
                words={room.wordOptions}
                timeLeft={room.game?.timeLeft ?? 15}
                onChoose={room.chooseWord}
              />
            )}
            <RoundOverlay
              roundEnd={room.phase === 'roundEnd' ? room.roundEnd : null}
              gameOver={room.phase === 'gameOver' ? room.gameOver : null}
              players={room.players}
              isHost={room.isHost}
              onReturn={room.returnToLobby}
            />
          </div>
          {canDraw && (
            <Toolbar
              color={color}
              size={size}
              onColor={setColor}
              onSize={setSize}
              onUndo={() => canvasRef.current?.undo()}
              onClear={() => canvasRef.current?.clear()}
            />
          )}
        </section>
        <Chat
          messages={room.messages}
          onSend={room.sendText}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}
