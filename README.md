# Skkribbl

The reasoning behind the structure is in [DESIGN.md](DESIGN.md). Questions a walkthrough tends to ask, with answers, are in [QUESTIONS.md](QUESTIONS.md).

A private-room drawing and guessing game. One player draws a word, everyone else tries to name it, and the highest score after the last round wins.

The browser is only a client. The Node server owns the room, the word, the clock, and the scores.

## Run it locally

Node 18 or newer.

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/socket.io` and `/api` to the API on port 3001.

`npm test` checks guess matching and the score formula.

To run the two processes yourself:

```bash
npm run dev -w server
npm run dev -w client
```

Production, one process:

```bash
npm install
npm run build
npm start
```

The server listens on `PORT` (default 3001), serves the built client, and hosts Socket.IO on the same port. `GET /api/health` returns `{ "ok": true }`.

## How a game moves

1. The host creates a room and gets a 6-character code. The invite link is `/?room=CODE`.
2. Everyone waits in the lobby. Ready is visible, but the host can start as soon as two people are connected.
3. Turn order is shuffled once. A "round" in the settings means every player who was there at the start draws once. Total turns are players × rounds.
4. The drawer gets 1–5 words and 15 seconds to pick. Everyone else only hears that a word is being chosen. If the drawer waits, the server picks.
5. The drawer paints. Guessers type in the same box they use for chat. A correct guess is not repeated in chat; the room sees "Alex guessed the word!"
6. The round ends when time runs out or every connected guesser has got it. The word is shown for 5 seconds, then the next drawer goes. After the last turn, the leaderboard stays up until the host returns to the lobby.

Settings the host can change before the start: 2–20 players, 2–10 rounds, 15–240 seconds, 1–5 word choices, 0–5 hints. The server clamps those values.

## Drawing

The canvas stores points as fractions of its width and height (`0–1`), so a phone and a laptop line up. The drawer paints immediately. About every 30ms the client sends `draw_move`. The server appends that point to the current stroke and relays it to everyone else.

A stroke is `{ color, size, points }`. Undo pops the last stroke. Clear wipes the list. Both are broadcast. On join or refresh, the server sends the stroke list so the canvas can be redrawn from scratch.

Colors and three brush sizes are a fixed set. The server drops anything outside that set. Only the current drawer can draw, and only while the round is in the drawing phase.

## Words, hints, and scores

Guesses are trimmed, lowercased, and collapsed to single spaces before they are compared.

- The same word is correct.
- One edit away is "close" (two edits if the word is longer than 6 characters). Only the guesser hears that.
- Anything else is ordinary chat.

The real word is sent only to the drawer, to a player who already guessed it, and to the whole room once the round is over. Shared updates carry the mask, like `_ _ a _ _`. Spaces start visible. Hints split the draw time into `hintCount + 1` slices and reveal one random hidden letter at the end of each slice except the last. One letter stays hidden until the round ends.

Scores:

- Guesser: `round(100 + 400 × timeLeft / drawTime) − 25 × earlierCorrectGuesses`, never below 50. The first guess on a full clock is 500.
- Drawer: 50 points for each player who guessed that round, added when the round ends. A drawer who leaves gets none of those points.

## Sockets

The browser sends intents. `server/src/socket.js` checks who is allowed to send them, then calls `Room` or `Game`.

Client → server: `create_room`, `join_room`, `leave_room`, `player_ready`, `update_settings`, `start_game`, `return_lobby`, `word_chosen`, `draw_start`, `draw_move`, `draw_end`, `draw_undo`, `canvas_clear`, `guess`, `chat`.

Server → clients: `room_joined`, `player_joined`, `player_left`, `room_update`, `game_state`, `round_start`, `timer_tick`, `hint_update`, `your_word`, `draw_data`, `canvas_state`, `guess_result`, `chat_message`, `round_end`, `game_over`, `error`.

`round_start` includes `wordOptions` only on the drawer's socket.

If a socket drops, the seat stays for 20 seconds so a refresh can reclaim the same player, score, and (if they are the drawer) the paused clock. After that the player is removed. The host role moves to the next player when that happens. If fewer than two players remain during a game, the room goes back to the lobby.

Rooms live in memory. Restarting the server clears them.

## Deploy

Use one Node service that can hold a WebSocket (Render or Railway). Don't host only the static client on Netlify or Vercel and expect Socket.IO to work there without a separate Node process.

- Build: `npm install && npm run build`
- Start: `npm start`
- Health check: `/api/health`

Set `PORT` if the host doesn't inject it. `CLIENT_ORIGIN` is optional and only needed if the site is opened from a different origin than the API.

Live URL: add it here after the service is public.

## Layout

```
client/   React + Vite
server/   Express + Socket.IO
  src/models/Player.js, Room.js, Game.js
  src/logic/   settings, words, guesses, hints, scoring, drawing
  src/socket.js
```
