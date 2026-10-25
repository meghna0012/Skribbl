# Design decisions

Skribbl is a private-room drawing and guessing game. One player draws a word. Everyone else tries to name it. The highest score after the last round wins.

This file is the walkthrough of the decisions in the code: what we built, what else was on the table, and why this version won. The scope is the must-have and should-have features of a skribbl-style game: rooms, a lobby, drawing that stays in sync, word choice, guessing, scoring, brush tools, hints, chat, a draw-time clock, and invite links. A Browse rooms tab (a capped list of open rooms) and an eraser were added after the first cut. Accounts, categories, kick, custom words, avatars, spectators, and replays were left out on purpose so the game stays something one person can explain end to end.

The code is written the way a developer with a couple of years of experience would write it: the server is the authority, the pieces have names you can point at, and there is no framework for a problem that is one process and a handful of classes.

## Language

**What we did.** Plain JavaScript on the client and the server. React function components. Node ES modules.

**Other options.** TypeScript on both sides. TypeScript only on the server. JavaScript with JSDoc types.

**Why this one.** The assignment was a game, and the interesting bugs are about turns, the secret word, and the clock. Types would have caught a misspelled field. They would not have caught "the drawer can see their own stroke twice" or "the word leaked in a broadcast." Plain JavaScript keeps every file readable without a compile step in your head, which matches the level we were aiming at. The server and the client still share the important constants by copying them and saying so in a comment (`COLORS` / `SIZES` must match `PALETTE` / `BRUSH_SIZES`), because a shared package for twelve colors would have been more machinery than the colors.

## One Node process

**What we did.** Express, Socket.IO, and the built React app all run in one process. In development, Vite is on port 5173 and proxies `/socket.io` and `/api` to port 3001. In production, `npm start` serves `client/dist`, `/api/health`, and the socket on `PORT`.

**Other options.**

- A static host (Netlify, Vercel, S3) for the React app and a second host for the API.
- Next.js, so the UI and the API share one framework.
- Two Node processes in production as well, with nginx in front.

**Why this one.** The game is a websocket. A static host can serve the JavaScript, and then the browser still needs a long-lived process for the socket. Splitting them means CORS, two deploys, and a place to put the room memory. One process means the invite link, the health check, and the socket are the same origin, so the client socket is created with no URL at all. Vite stays in development because hot reload is worth a proxy. Next.js was the wrong shape: this UI has three screens and no pages that need server rendering. The SPA fallback in `server/src/index.js` skips `/api` and `/socket.io` so a refresh on `/?room=CODE` still loads the app, and a socket handshake is not swallowed by `index.html`.

`strictPort` on Vite is there so a busy 5173 fails loudly. If Vite quietly moved to 5174, the proxy story in the README would be a lie.

## Socket.IO, not raw websockets

**What we did.** Socket.IO 4, with rooms named `room:${code}`.

**Other options.** The `ws` package. Server-Sent Events plus POST for guesses. A library such as PartyKit or a hosted realtime product.

**Why this one.** The brief named Socket.IO. It also gives us rooms, acknowledgements, and reconnects without writing a frame protocol. Raw `ws` is smaller and would have forced us to invent event names, acks, and "the socket dropped, try again" ourselves. That is a fine project. It is a different project. A hosted realtime service would hide the part we were supposed to learn.

The `room:` prefix exists because Socket.IO room names and socket ids share one namespace. A room code that happened to equal a socket id would deliver a broadcast to one person. Prefixing makes that collision impossible.

## Where the rooms live

**What we did.** A `Map` in `server/src/store.js`. The process is the database. Restarting it deletes every room.

**Other options.**

- Redis, so two Node processes could share rooms.
- Postgres or Mongo, so a room survived a restart.
- A file on disk.

**Why this one.** A room is a live object: a timer, an open socket list, and a stroke array that changes many times a second. Putting that in Redis means serializing it on every point. Putting it in Postgres means the same, plus a schema for something that is gone when the players leave. A file would corrupt if the process died mid-write. The in-memory map matches the lifetime of the game. The cost is honest and written down: this build cannot scale sideways, and a deploy kicks everyone out. `onEmpty` deletes the room when the last seat is removed, so the map does not grow with abandoned codes.

## Invite codes, plus a capped Browse list

**What we did.** Every room is created invite-only: a 6-character code and a `/?room=CODE` link. On top of that, a room is *listed* by default, and the host can untick "List in Browse rooms" to keep it code-only (`settings.listed`). The Browse rooms tab on the home screen shows at most 10 rooms, newest first, skipping unlisted and full ones. Each row carries only the host name, `players/max`, and rounds, plus the code the Join button needs. The server owns the list (`listBrowsableRooms` in `store.js`) and pushes `room_list` to every socket whenever a room is created, joined, left, or emptied. There is no matchmaking and no "quick join."

**Other options.**

- Code-only, with no list at all (the first version).
- A quick-join button that drops you into the first open room.
- A two-way public/private toggle with listing off by default.
- A full, paged lobby browser with search and filters.

**Why this one.** The assignment lists public rooms as optional and wants private invite rooms kept. Treating "listed" as a per-room opt-out gives both without a second room type: the room object, join path, and code are identical. The cost is real and written down: a listed room is discoverable by strangers, and there is no kick or report, so the host's only protection is unticking the box. That is why the default is a one-line change in `clampSettings` if you would rather make listing opt-in. Capping at 10 and dropping full rooms keeps a dead row from using a slot, and a single push event keeps the list fresh without polling. Rooms already in a game stay listed while they have space, because late join is supported. The code alphabet is `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Zero, O, one, and I are missing so a code read out loud is less ambiguous. Six characters from 32 symbols is large enough that `uniqueCode` almost never retries, and small enough to read in a chat message.

## Player, Room, and Game

**What we did.** Three classes. `socket.js` checks who is asking and then calls a method. Pure functions in `logic/` do settings, guess matching, scoring, hints, drawing sanitizing, and word picking.

**Other options.**

- One big socket file with the rules inline.
- A state-machine library (XState or similar).
- Redux-style reducers on the server.
- One `Room` class that also owns the turn.

**Why this one.** The socket file is the place bugs hide if it also knows the score formula. Keeping it as a guard ("are you the host, are you the drawer, are you sending text too fast?") means the rules can be read in `Game` without a socket nearby. A state-machine library would name the phases we already named (`lobby`, `choosing`, `drawing`, `roundEnd`, `gameOver`) and add a dependency to learn. Reducers on the server would fight the timer and the stroke list, which are naturally methods on an object.

`Room` owns people, settings, chat, and "are we in a match." `Game` owns the turn, the word, the clock, and the strokes. That split is why leaving the match (`returnToLobby`) can throw the `Game` away and keep the room code, the host, and the players.

## The server decides

**What we did.** Scores, the word, the clock, hints, and whether a message is a guess all live on the server. The client displays what it is sent and paints strokes.

**Other options.** Trust the client for "I guessed it" and for the timer. Run the match locally and only sync the canvas.

**Why this one.** Anyone can open the devtools and emit `guess` with the word, or emit `draw_start` while they are not the drawer. If the client awarded points, that would be the game. `actor()` in `socket.js` requires the socket id on the seat to match the socket that sent the event, so a second tab cannot act as the first. Draw methods on `Game` ignore anyone who is not the current drawer. Settings are clamped again in `logic/settings.js` even though the form already has min and max.

## The word never rides along with shared state

**What we did.** `round_start.wordOptions` goes only to the drawer's socket. Shared state (`toPublic`) carries the mask. `your_word` is a private event for the drawer, for someone who already guessed, and for everyone once the round is over and the word is public.

**Other options.**

- Put the word on the shared state and hide it in CSS.
- Send the word to everyone and trust the client not to render it.
- Encrypt the word with a key only the drawer has. The server would still be the one encrypting it, so this adds nothing.

**Why this one.** Hiding a field in the UI is not hiding it. The socket debugger, React devtools, and a modified client would all show it. Sending the options on a single socket means a guesser never receives the list to ignore. The mask is safe to broadcast because it is exactly what guessers are supposed to see.

During choosing, the drawer cannot type a word option into chat. Otherwise they could "accidentally" paste the answer into the shared transcript before the round starts.

## How a guess is classified

**What we did.** One text box. Both the `guess` event and the `chat` event go through `judgeGuess`. Normalize with trim, lowercase, and collapsed spaces. Exact match scores. Levenshtein distance of 1 is "close," or 2 when the word is longer than 6 letters, and only if the length difference is already inside that limit. Anything else is chat. Empty text is ignored. Messages are capped at 100 characters. Text is rate-limited to one every 250ms.

**Other options.**

- Two boxes, one labeled Guess and one labeled Chat, and only the Guess box is checked.
- Substring matching ("cat" is close to "category").
- A spellcheck library.
- Sending "close" to the whole room.

**Why this one.** Two boxes look clearer and are easy to bypass: emit `chat` with the answer. Running both events through the same function makes the button label a hint, not a permission. Substring matching marks "a" as close to almost every word, which turns the box into a fishing tool. Levenshtein is a small function, it handles a missing letter and a swap, and words are short enough that two rows of dynamic programming are easy to read. The length check skips the matrix when the strings cannot possibly be close. "Close" goes only to the guesser. Broadcasting it would tell the room which messages were near the secret. Punctuation is not stripped, so "cat!" is not "cat." That is a little strict, and it is easy to explain.

## Scoring

**What we did.** A correct guess scores `max(50, round(100 + 400 * timeLeft / drawTime) - 25 * earlierCorrect)`. The first guess at full time is 500. Each earlier correct guess in the same round costs 25, and the result never goes below 50. The drawer scores `50 * correctGuessers`, paid once at round end. The drawer scores nothing if the round ended because the drawer left. A player who already guessed cannot score again. The drawer cannot guess their own word.

**Other options.**

- Flat points, first correct guess gets 100, everyone else gets 100.
- A curve copied from a live skribbl (which is not published as a spec we could rely on).
- Pay the drawer at the moment of each guess.
- Pay the drawer even if they disconnect, as a consolation.

**Why this one.** The formula is short enough to say out loud: speed is the 400, showing up at all is the 100, being later than other people is the 25, and 50 is the floor. A flat score makes the clock decorative. Paying the drawer per guess means a reconnect in the same round could double-count if we are not careful. Paying once at the end, from the list of people who got it, is one assignment. Skipping that payment when the drawer left keeps a disconnect from being a strategy: draw nothing, drop, still collect. `drawTime` of 0 is guarded so the ratio is 0 and the base is 100, not `NaN`. Settings already reject 0. The guard is for a bad caller and for the test.

## Hints

**What we did.** The draw time is split into `hintCount + 1` slices. At the end of each slice except the last, one random still-hidden letter opens. At least one letter stays hidden. Spaces in the word are visible from the start. The mask is joined with spaces (`_ _ a _`) so each blank is readable.

**Other options.**

- Reveal on a fixed schedule (letter 1 at 30s, letter 2 at 50s) regardless of draw time.
- Reveal from the left, in order.
- Reveal every letter except we stop at the last one by a special case in the UI.
- Let the client open letters when its own clock hits the mark.

**Why this one.** A fixed schedule breaks when the host sets draw time to 20 seconds and the hints were designed for 80. Slices scale with the setting. Random letters are more interesting than always revealing the start of the word, and they are harder to use as a prefix you can search against. Stopping when only one letter is still hidden is a rule in `revealOne` (it returns the same array), so a 2-letter word reveals at most one letter and a long word never gets spelled out before time runs out. The client only renders the mask it is sent.

## The clock

**What we did.** One `setInterval` at 1 second on the server. Clients get `timer_tick`. Choosing a word lasts 15 seconds, then the server picks at random. The gap between rounds is 5 seconds. If the drawer disconnects, the interval stays up but `tick` does not decrement while `paused` is set.

**Other options.**

- Each client counts down from the start time and the server only checks at the end.
- A timeout per second that reschedules itself (`setTimeout` chain).
- Pause by clearing the interval and starting a new one on reconnect.
- Skip the drawer's turn immediately on disconnect.

**Why this one.** Client clocks drift, and a player with a fast clock would see 0 while the server still accepted guesses. One interval is the official clock. We send the remaining seconds rather than asking clients to subtract. An interval that keeps running while paused is easier to reason about than "remember how many seconds were left, clear the timer, start it again." Skipping the turn on a refresh would punish a reload. Pausing gives the 20 second grace window a chance to matter.

## Turns

**What we did.** The player list is shuffled once when the game starts. That order repeats for every round. A "round" in the settings is a full cycle, so the number of turns is players times rounds. The round ends when the timer hits 0 or every connected non-drawer has guessed. If fewer than two players are connected mid-game, the match is abandoned back to the lobby with no winner. Ties: everyone at the top score wins, and the overlay says so. Only the host can `return_lobby`, and only from `gameOver`. Scores reset. The room code stays.

**Other options.**

- Reshuffle every round.
- "Rounds" means "turns," so a 3-round game with 5 people is three drawings total.
- Ready does not block start (the first version).
- Anyone can return the room to the lobby.

**Why this one.** Shuffling once means you can tell people "you'll draw after Ada" and it stays true. Reshuffling is fair in a different way and makes the order impossible to follow. Defining a round as a full cycle matches the way people talk about the game: everyone draws once per round. Ready gates the start: `Room.startGame` refuses unless every connected player other than the host has pressed Ready, and the error names who is missing. The first version did not gate it, because one player who forgets to click would stall the host. We changed it because a Ready button that does nothing is worse than a rule people can see, and because Browse puts strangers in the lobby, where "is everyone set" matters. The host counts as ready by pressing Start, so they get no Ready button. A disconnected seat is ignored, the same way it is for the two-player minimum, so a ghost in the 20 second grace window cannot block a start. The cost is the one we had before: an idle player can hold the lobby, and the host has no override. A kick or a host "start anyway" would fix that, and neither exists yet. Start still requires the host and at least two connected players. Letting any player reset the match would let a sore loser end it.

`beginTurn` skips a seat that is gone, so a player who left during the 5 second gap does not trap the game on a drawer who is not there.

## Drawing

**What we did.** HTML canvas. Points are 0 to 1 relative to the canvas. The drawer paints locally and the server does not echo `draw_data` back to them. The server stores strokes as `{ color, size, points[] }` and relays them to everyone else. A guesser who joins or refreshes mid-round gets `canvas_state`. The client sends move events at most every 32ms. A stroke is capped at 4000 points. Undo pops the last stroke. Clear wipes the list after a confirm on the client. Colors come from a 12-color palette. Brush sizes are 0.006, 0.014, and 0.028 of the canvas width. The server snaps a color or size that is not in the list.

**Other options.**

- Pixel coordinates.
- A bitmap (PNG) broadcast on an interval.
- Echo every point back to the drawer and let them paint from the server stream.
- Fabric, Konva, or perfect-freehand.
- An eraser as a destination-out stroke (a true compositing mode). We use a white stroke instead. See below.
- Free color input and free brush size.
- Putting each point in React state.

**Why this one.** Pixel coordinates break as soon as two windows are different sizes. A stroke recorded at 1200px wide lands in the wrong place on a 400px wide phone. Fractions replay on whatever size the canvas is right now, and brush width is a fraction of that width so "thick" stays thick after a resize. A bitmap is simple to display and painful to undo, and it is heavy on the socket. Echoing points back to the drawer adds a round trip to their own line, which feels laggy, and it double-draws if we also paint locally. Painting locally and broadcasting to everyone else is the usual split: the drawer's line is instant, everyone else is one network hop behind.

We did not pull in a canvas library. The feature set is polylines, three widths, undo, and clear. A library would be most of the client bundle for that. React state per point would re-render the chat, the scores, and the toolbar thirty times a second. The canvas keeps strokes in a ref and the rest of the app hears "a command arrived" through one `canvasCmd` object with a fresh id, because the same stroke object sent twice must still count as a new command.

The 32ms throttle drops samples, not the stroke. `pointerup` always sends the last point, so a fast flick still ends where the finger lifted. The 4000 cap is a guard against a stuck pointer flooding the room. Snapping color and size on the server means a modified client cannot send a 200px brush or a color that fails to render. The eraser is a normal stroke painted in the board color (`ERASER_COLOR`, white). The canvas is always filled opaque white before strokes are replayed, so a white stroke looks erased. Because it is a stroke it needs no new socket event and no server rule: it is stored in order, relayed, undone, cleared, and replayed to late joiners like any other line. White is already in the palette, so the server's color snapping keeps it, and `eraser.test.js` pins that coupling. The trade-off is that erasing adds a stroke instead of removing pixels, so a heavily erased picture holds more strokes than a true destination-out eraser would. It also depends on the board staying opaque white. If the board ever gets a background color or image, switch to a composite mode and add a flag to the stroke.

`touch-action: none` on the canvas is what stops the page from scrolling while a finger draws.

## Disconnects

**What we did.** A dropped socket keeps the seat for 20 seconds (`GRACE_MS`). The player is marked disconnected. If they were drawing, the clock pauses. Reclaim needs the same player id and the same name, or the room has exactly one disconnected player with that name. A second tab emits `session_taken` to the old socket and takes the seat. Explicit leave, or creating another room, detaches immediately and does not wait out the grace period. Host moves to the next player in join order only when the seat is actually removed. An empty room is deleted.

**Other options.**

- Remove the player on `disconnect` immediately.
- Keep the seat until the game ends.
- Identify a reconnect by name only.
- Transfer the host as soon as the host's socket drops, before the grace window.

**Why this one.** Immediate removal makes a refresh steal your turn and your score. Keeping the seat forever fills the room with ghosts and blocks `maxPlayers`. Twenty seconds is long enough to reload and short enough that a player who closed the laptop does not hold the game all night. The pause is what makes those twenty seconds usable for the drawer. Name-only reclaim would let a second person join as "Ada" and take the score. The player id in `sessionStorage` is the real key. The name check is a second lock so a copied id with a different name does not attach. Host transfer waits for real removal because a host who refreshes should still be host when they come back.

`sessionStorage` rather than `localStorage` means this tab remembers the seat and a brand-new tab does not silently jump into yesterday's room. The URL still has `?room=CODE`, so the new tab can join on purpose.

## Client structure

**What we did.** One `useRoom` reducer. Screens read that object and call functions on it. They do not know event names. There is no React Router. `App` picks Home, Lobby, or Game from the phase. The canvas stays mounted across choosing, drawing, round end, and game over. Overlays cover it. Styling is one CSS file with a few custom properties. No component library.

**Other options.**

- Redux or Zustand.
- React Router with `/room/:code`.
- CSS modules, Tailwind, or a kit such as MUI.
- Lifting strokes into the reducer.

**Why this one.** The client state is "the last thing the server said," plus a busy flag and a toast. A reducer gives each server event a name (`joined`, `roster`, `round_start`, `timer`) without a store library. Router URLs are nice for many pages. Here the server already decides the page, and a refresh is handled by the session plus `?room=`. Tailwind would be fine and would add a build convention for a layout of three columns. One stylesheet is enough to see that the stage is `240px`, a flexible board, and `300px`, and that under 980px those columns stack. Side panels get a max height in that breakpoint so the canvas is still on screen.

The lobby code button uses `align-self: flex-start`. The lobby is a flex column. `justify-self` does nothing there, and the button stretched across the panel until that was fixed.

Chat history is capped at 80 lines on the server and again when the reducer appends, so a long game does not grow the DOM without bound.

## Words

**What we did.** About 360 words in `words.json`, loaded once with `readFileSync` at startup. `pickWords` prefers words that have not been used in this match, and falls back to the full list when the fresh pool is smaller than the number of options. The drawer is offered `wordCount` choices (1 to 5, default 3).

**Other options.** An API that returns a random word. A list in the source file. Categories. Letting the host type custom words.

**Why this one.** A word API is a runtime dependency for something that should work offline and in a demo. A JSON file is easy to edit and is not parsed on every turn. Tracking used words keeps a short game from repeating "cat." Falling back when the pool is thin means a long game with a small list still starts every turn, instead of erroring on the last round. Custom words and categories were out of scope. They also need moderation, because a custom word is an opportunity to write something the other players did not agree to draw.

## Acknowledgements and the error event

**What we did.** Actions that can fail (create, join, start, settings, choose word, text) take an acknowledgement callback. The client turns `{ ok: false, error }` into a toast. Draw events have no ack. The server also emits `error` for a few cases. The client ignores an `error` payload that looks like a JavaScript `Error` (it has a `stack`), so a real exception is not shown as a toast on top of the ack.

**Other options.** Only the `error` event. Only acks. Acks on every stroke.

**Why this one.** An ack is tied to the action that failed, which is what you want for "room is full." A broadcast `error` is easy to show twice if the ack already reported it. Strokes are frequent. Waiting for an ack before accepting the next point would make the line depend on the round trip. The drawer has already painted locally.

## Tests

**What we did.** `node:test` for `judgeGuess` and the score formula. No browser test runner. No test that boots Socket.IO.

**Other options.** Jest. Playwright for the two-player flow. A test per socket event.

**Why this one.** The pure functions are where an off-by-one becomes points or a leaked "close." They run with zero setup and no open ports. A socket test needs two clients, timers, and the word list, and it is brittle in CI for a project this size. The two-player path was exercised by hand against a running server. Jest would duplicate what Node already ships.

## What this design refuses to pretend

A second server cannot see the `Map`. There is no login, so "who are you" is a player id in this tab. There is no kick, no ban, and no replay, so a listed room is only as safe as its host's choice to unlist it. The live URL in the README is a placeholder until someone deploys the single Node service. Those are boundaries, not bugs waiting in the code.
