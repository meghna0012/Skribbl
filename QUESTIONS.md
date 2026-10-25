# Questions this project raises

These are the questions a walkthrough, a review, or an interview tends to pull out of Skribbl, with the answer that matches the code. Read [DESIGN.md](DESIGN.md) for the option-by-option decisions. This file is the longer explanation of each question.

## 1. Walk me through one stroke, from the drawer's mouse to another player's screen.

The drawer is the only person with `interactive` on the canvas, and only while the phase is `drawing` and the game is not paused. Pointer down computes a point as a fraction of the canvas (`x` and `y` between 0 and 1), paints it locally, and emits `draw_start` with the color, the size, and that point. Pointer move does the same with `draw_move`, but at most once every 32 milliseconds. Pointer up always emits `draw_end` with the final point, even if the throttle skipped the last move. That matters for a fast flick: the line has to end where the finger actually lifted.

`socket.js` checks that this socket is the drawer, then `Game` appends the point to the current stroke and emits `draw_data` to the room except the drawer's socket. Other clients receive it in `useRoom`, which stores a command object with a new id. `Game.jsx` sees that id change and calls `apply` on the canvas ref. The canvas converts the fractions back to pixels using its own width and height and redraws.

The drawer does not get their own `draw_data`. Their line is already on the canvas. Echoing it would either double-draw or force them to wait a round trip to see their own ink.

## 2. Why are coordinates between 0 and 1 instead of pixels?

Two browsers almost never have the same canvas size. A point recorded as "400 pixels from the left" on a laptop is a different place on a phone, and it is a different place again after someone resizes the window. A fraction is "40% across, 60% down." Each client multiplies by the canvas they have right now. Brush size is also a fraction of the width (`0.006`, `0.014`, `0.028`), so a thick stroke stays thick when the board gets narrower. The server snaps the size to the nearest allowed value, so a client cannot send an arbitrary width and have everyone else honor it.

## 3. What is the source of truth for the picture?

The stroke list on the server, not the pixels. Each stroke is a color, a size, and an array of points. Undo pops the last stroke and tells everyone to drop it. Clear replaces the list with an empty one. A player who refreshes, or who joins during the round, receives `canvas_state` with the whole list and paints it from scratch. If the bitmap were the source of truth we would have to ship a PNG for every undo, and a late joiner would need a full image that might not match their canvas size. Redrawing polylines is cheap at the length of a round.

The list is capped at 4000 points per stroke so a stuck pointer cannot grow it without limit.

## 4. Why doesn't the drawer receive their own draw events?

Local paint is immediate. The network is not. If the drawer waited for the server to send the point back, the line would lag behind the cursor by the round trip, and on a bad connection it would feel broken even though the drawer is the one person who does not need the server to know where their cursor is in order to see it. The server still stores the point, because everyone else, plus a later refresh, needs it. The drawer's client and the server can differ by the samples the 32ms throttle dropped. That is acceptable. The stroke is the same shape, with fewer points on the way out.

## 5. How does the timer stay honest?

The server runs one 1 second interval for the whole match. Each tick sends `timer_tick` with the remaining seconds. Clients format that number. They do not subtract from a local deadline.

If each browser counted down from "the round started at T," a laptop with a drifted clock would hit zero early and either show a lie or, worse, if we trusted it, stop accepting guesses while the server still thought time remained. Guessing is scored from the server's `timeLeft`, so the number on screen and the number in the formula are the same value.

Choosing a word is the same clock, with a separate counter of 15 seconds. If the drawer does not click, the server picks one of the options at random. The gap after a round is a 5 second timeout, not the interval, because nothing about that gap needs to be scored.

## 6. What happens if the drawer refreshes mid-round?

`disconnect` does not delete the seat. It marks the player disconnected and starts a 20 second timer. If they were the drawer, `Game` sets `paused` and the interval stops decrementing. The seat still holds the player id, the score, and the role.

The tab has `sessionStorage` under `skribbl-session` with the room id, the player id, and the name. On connect, if that room matches the room in the URL (or the URL has no room), the client emits `join_room` with the player id. The server reattaches that seat, clears the disconnect timer, and if they were drawing, unpauses. The client also gets `canvas_state`, so the picture comes back.

If they do not return within 20 seconds, the seat is removed. If they were drawing, the round ends with reason `drawer_left` and the drawer is not paid for that round. If the room drops below two connected players, the match is abandoned to the lobby with no winner.

## 7. How do you stop the secret word leaking to guessers?

Shared broadcasts are built by `toPublic`, which includes the mask and never the word. The three options go out on `round_start` only to the drawer's socket. If that drawer refreshes while they are still choosing, `room_joined` (built by `viewFor` for that socket alone) includes `wordOptions` again, and it includes `yourWord` only when this player is the drawer, has already guessed, or the round is in the public reveal. After a correct guess, that one player also gets a `your_word` event. At round end the word is public on purpose, because the reveal is the point of the overlay.

Hiding the word in React and still putting it in the payload would fail the moment someone opened the socket log. The rule is that a guesser's process is never sent the string.

A related hole: during choosing, the drawer could type one of the options into chat and "spoil" it as an ordinary message. `handleText` blocks the drawer from sending a message that matches an option in that phase.

## 8. Walk through a correct guess.

Ada is drawing "shower." Bea types `Shower` in the one text box. The client sends `guess` because Bea is not the drawer, the phase is `drawing`, and Bea has not already guessed. The server would run the same check if the client had sent `chat` instead.

`judgeGuess` trims, lowercases, and collapses spaces. `shower` equals `shower`, so the result is `correct`. Bea is added to the guessed set. Points are computed from the time left and how many people had already guessed. The room sees a system chat line, "Bea guessed the word!" The line does not contain the word. Bea receives `your_word` so her hint bar can show it. Her input switches to chat, and a later exact guess from her will not score again.

If Bea was the last connected guesser, the round ends immediately instead of waiting for the clock.

## 9. What is a "close" guess, and who hears about it?

After normalizing, if the strings differ, the limit is 1 edit, or 2 edits when the word is longer than 6 characters. If the lengths already differ by more than that limit, it is chat and we skip the distance calculation. Otherwise Levenshtein distance decides. Within the limit, the guesser alone gets `guess_result` with `close: true`, and their own client appends "Very close!" to the transcript. The rest of the room sees the text as a normal chat line, with no flag.

We do not broadcast "close." That would tell everyone which of Bea's messages was one letter off, which is almost as good as telling them the word.

`cat` versus `dog` is distance 3, so it stays chat. A one-letter word is hard to be "close" to without being correct, and the "leave one letter hidden" hint rule is a separate concern.

## 10. Why Levenshtein instead of "the guess contains the word" or the other way around?

Substring checks reward fishing. The guess `a` is a substring of a huge fraction of the list. The word being a substring of a long sentence would mark an entire chat message as close. Edit distance asks a narrower question: did they miss by a typo? It costs a short function, words are at most a few dozen characters, and we keep two rows of the matrix instead of the full table because the previous row is all the recurrence needs. Punctuation is not removed. `cat!` is not `cat`. That will annoy someone once, and it keeps the normalizer to three operations we can describe.

## 11. Give me the score numbers.

`guesserPoints` is `max(50, round(100 + 400 * timeLeft / drawTime) - 25 * earlierCorrect)`.

- First guess as the round starts (`timeLeft === drawTime`, nobody else yet): `round(100 + 400) = 500`.
- First guess at half time: `round(100 + 200) = 300`.
- Second guess at half time (`earlierCorrect` is 1): `300 - 25 = 275`.
- A very late guess after many people: the subtraction can go below 50, and the floor holds it at 50. The test case is full time with 20 earlier correct guesses: `500 - 500 = 0`, then the floor returns 50.
- If `drawTime` is 0 the ratio is forced to 0, so the base is 100 rather than `NaN`. The settings clamp already rejects a zero draw time. The guard is so a bad caller and the unit test have a defined answer.

The drawer does not use this formula. At round end they receive `50 * (number of correct guessers)`. Two people got it, the drawer gets 100, once. If the round ended because the drawer left, that payment is skipped.

## 12. Why pay the drawer at the end of the round instead of on each guess?

The drawer's score is a function of a count. Paying as each guess arrives means every path that adds a guesser has to remember to pay, and a bug that records the guess twice pays twice. Paying once, from the list, when the round ends, is a single assignment. It also gives us one place to say "not if the drawer already left." Disconnecting would otherwise be a way to lock in points and skip the rest of a bad drawing.

## 13. How do hints get revealed?

`hintsDue` divides the draw time into `hintCount + 1` slices. After each slice except the last, one more letter is due. With 80 seconds and 2 hints, the slices are about 26.7 seconds. Around 27 seconds the first letter opens. Around 53 seconds the second opens. The last slice runs out the clock with no extra reveal.

`revealOne` picks a random index that is still hidden and is not a space. If only one such character remains, it returns the same array. The word is never fully spelled by hints. Spaces are shown from the first mask (`ice cream` has a visible gap), because a space is structure, not a hint. The mask string is characters joined by spaces, `_ _ a _ _`, so the blanks do not collapse into an unreadable run in the UI.

The client never decides that a hint is due. It renders `hint_update`.

## 14. What does "everyone guessed" mean?

Every connected player who is not the drawer is in the guessed set. Disconnected seats are not required. Otherwise a player who closed their laptop would freeze the round until the clock, even though nobody present still needs to guess. The drawer is excluded because they are not allowed to guess their own word. When the condition flips true, the round ends with that reason and the overlay says everyone got it, instead of "time's up."

## 15. Why 20 seconds of grace, and why pause instead of skipping?

A refresh is a disconnect followed immediately by a new socket. Deleting the player on `disconnect` would drop their score and, if they were drawing, end their turn every time the devtools reloaded the page. Keeping them forever lets abandoned seats fill `maxPlayers` and stall "everyone guessed" if we had counted disconnected people.

Twenty seconds is enough to reload and not enough to go make coffee while the table waits. Pausing the draw clock is what makes the grace period real for the drawer. If the clock kept running, the round would often hit zero before the refresh finished, and the grace period would only save the score, not the turn. Skipping the turn immediately is the other honest choice. It punishes the reload, which is the common case, to speed up the rare case of a drawer who actually left.

Explicit leave does not use the grace period. The player asked to go. Creating a new room also detaches the old seat immediately, so one person cannot hold a ghost seat in a room they have abandoned.

## 16. When does the host change?

Only when the host's seat is actually removed. A refresh starts the grace timer and the host is still the host. If they come back, they are still the host. If the timer fires, or they clicked Leave, the next player in join order becomes host. Join order is stable. We do not pick the highest score, because the host's job is "can start the game and can return to the lobby," not "is winning."

Transferring on the disconnect event, before grace, would flicker the host crown onto someone else for the length of a reload and might let them start or change settings in that window.

## 17. Why is there no database?

A room is a timer, a set of sockets, and a stroke list that updates many times a second. The useful lifetime is "while these people are playing." A database would mean writing that object on every point, or writing it on a delay and accepting that a crash loses the last few seconds anyway. Postgres does not make the game more correct for one process. Redis would matter if we wanted a second process to share the rooms. We do not. The `Map` in `store.js` is the whole persistence story, and a restart empties it. That is written in the README so nobody treats a deploy as seamless.

## 18. Why Socket.IO instead of the ws package?

The product requirement was Socket.IO, and it supplies rooms, reconnect, and acknowledgement callbacks. With `ws` we would have built a small protocol: event names, JSON envelopes, "this message is the reply to that one," and reconnect. That is educational and it is a different assignment. Socket.IO's cost is a thicker client and a handshake that is not a raw WebSocket until the upgrade finishes. The Vite proxy enables `ws: true` so that upgrade is forwarded in development.

Room names are `room:${code}` because a Socket.IO room and a socket id live in the same lookup. A code that collided with an id would deliver a broadcast to a single socket.

## 19. Why can't this be deployed as a static site?

The browser needs a process that stays up and holds the rooms. Vercel, Netlify, and any host that runs a function per request will accept the HTTP page and then drop the socket, or cold-start a new process that has an empty `Map`. The production shape is one Node service: `npm run build` then `npm start`. Express serves `client/dist`, the health route, and Socket.IO on the same port. The SPA fallback sends `index.html` for frontend routes and refuses to do that for `/api` and `/socket.io`, so the handshake is not replaced with HTML.

There is no live URL in the repo yet. The README says to fill it in after the service is public.

## 20. What breaks if we run two servers?

The `Map` is local. A player who creates a room on process A and whose friend lands on process B gets "no such room." Sticky sessions would paper over it only until a restart, and a draw event handled on the wrong process would not see the stroke list. Sharing rooms means an external store and a fan-out for socket events (Redis adapter is the usual Socket.IO answer). We did not build that. Scaling this game is a different design, and pretending the `Map` is a cache in front of nothing would be worse than the limitation.

## 21. What if a guesser emits draw events?

`Game` checks the drawer id on stroke start, point, end, undo, and clear. A non-drawer is ignored. The client also does not render the toolbar and does not set the canvas interactive, but that is a courtesy. The check that matters is the one on the server, because the client can be modified.

The same pattern covers start game (host only, at least two connected players, lobby phase), settings (host, lobby only), word choice (the current drawer, choosing phase), and return to lobby (host, game over only).

## 22. Can I cheat by sending the answer as a chat message?

No, if "cheat" means scoring or spoiling without the server noticing. `guess` and `chat` both call `handleText`. The classification does not trust the event name. An exact match scores, a close match warns only you, and anything else is published as chat. The one extra case is the drawer during word choice: a message that equals one of the options is dropped so they cannot paste the answer into the transcript early.

What you can still do is say something suggestive that is not within edit distance of the word. That is just talking. The game does not try to police hints people give each other in words.

## 23. What does the client do with all these events? Why a reducer?

Socket handlers run outside React's render. If each one called a `useState` setter closed over old state, a burst of `player_joined` and `game_state` would drop updates. A reducer takes the previous state and one action and returns the next state, which is the right shape for "an event arrived." `useRoom` is the only module that knows event names. Screens call `startGame`, `sendText`, `chooseWord`. Swapping an event name is a change in one file.

We did not add Redux. The state is one room. There is no other slice.

Strokes are deliberately not in the reducer. A point every 30ms would re-render the player list and the chat. The reducer stores a single command (`canvasCmd`) and the canvas applies it imperatively.

## 24. Why is there no router?

The screen is a function of server phase. No room yet: Home. Phase `lobby`: Lobby. Anything else: Game, with overlays for choosing, round end, and final scores. A route like `/room/CODE` would duplicate the query string we already write, `/?room=CODE`, which is the invite link. Refresh is handled by `sessionStorage` plus that query, not by a route match. Adding React Router would give us a dependency and a URL design we would then have to keep in sync with the server.

## 25. How does undo and clear stay in sync?

Undo emits `draw_undo`. The server pops the last finished stroke and broadcasts the same event. Every canvas, including the drawer's, drops the last stroke and redraws from the list it holds. Clear is the same with an empty list, after a `window.confirm` so a mis-click does not wipe the round. Because everyone redraws from strokes rather than from a bitmap, undo does not require "here is the image from one second ago."

A stroke that is still in progress is ended or ignored according to the server's stroke methods before pop. The client finishes the local gesture on pointer up. The important invariant is that the next `canvas_state` (a refresh) matches what the server popped, not whatever the drawer's local list did if it raced.

## 26. How are room codes generated, and why do they avoid 0, O, 1, and I?

`makeRoomCode` draws 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Those four glyphs are the ones people misread in a chat message or on a blurry screen. The store checks the `Map` and retries on collision. The space is 32^6, about a billion, so a retry is rare at any population this process can actually hold. Six characters is still short enough to type from a voice call. Longer codes are safer and worse to share, which misses the point of an invite.

## 27. What happens when the word list runs out?

`pickWords` builds a pool of words not yet used in this match. If that pool is smaller than the number of options the drawer should see, it uses the full list again. A long game with many rounds will repeat words rather than fail to start a turn. The list is about 360 drawable nouns, loaded once at startup. We do not call an external word API, so a game still starts with no network beyond the players' own sockets.

## 28. Why shuffle the turn order once?

The order is chosen at `start` and then repeated. Round 2 is the same sequence as round 1. Players can predict their turn, and "you're after Bea" stays true. Shuffling every round is slightly fairer if the first position is an advantage, and it makes the game harder to follow. With a small private group, predictability won.

A round in the settings is one pass through that order. Three rounds with four players is twelve drawings. The other interpretation, "three drawings total," surprises people who think everyone will get a turn.

`beginTurn` skips a missing seat, so a player who left during the five second gap does not stall the match on a drawer who is not connected.

## 29. Why doesn't Ready block the start button?

The lobby shows ready because a waiting room needs a way to say "I'm here." Gating start on every ready flag means one person who does not notice the button holds the group. In a public matchmaking queue that gate is useful. In a private room the host is already the person everyone is waiting on. Start is still refused unless the host sends it and at least two players are connected. A disconnected seat does not count, so a ghost from the grace window cannot be the second player.

## 30. Two tabs open the same room. What happens?

The second join that presents the same player id takes the seat. The previous socket receives `session_taken`, clears `sessionStorage`, and drops back to the home screen with a message. Both tabs acting as the drawer would split the stroke list and double-send guesses. One seat, one socket, is the rule `actor()` enforces: the socket id on the player has to match the socket that sent the event.

A different person using the same display name does not steal the seat. Reclaim needs the player id. The name match is an extra check, and the fallback (a single disconnected player with that name) covers a reconnect that lost the id but is unambiguous.

## 31. Why sessionStorage and not localStorage or a JWT?

`localStorage` would survive closing the tab. The next morning the browser would try to rejoin a room that no longer exists, or, worse, a room code that had been reused in a long-lived server. `sessionStorage` lasts for the tab, which is the lifetime of a game session. The URL is the shareable part. The storage is the secret-ish part (the player id).

A JWT implies an account, a secret, and an expiry story. We have no accounts. The player id is a random id minted by the server when the seat is created. It is a capability for that room until the seat is gone. Anyone who copies it can reclaim that seat until then. That is acceptable in a game with no personal data, and it would not be acceptable if the seat held a password or a payment method.

## 32. What about XSS in the chat?

Chat text is rendered as React children, which escape HTML. A message of `<script>` shows as the characters `<script>`. We do not use `dangerouslySetInnerHTML` on user text. Messages are also sliced to 100 characters, so the transcript cannot be filled with a huge payload in one send, and the 250ms rate limit slows a flood. The cap of 80 stored messages drops the oldest. None of that is a full abuse story (there is no auth and no per-room ban), and it does close the "paste a tag into chat" hole.

## 33. What is the race between the last second and a guess?

The interval and the socket handler share one process and one call stack. Node runs the tick to completion, then the guess, or the other way around. There is no second thread interleaving `timeLeft--` with the score math. If the tick that sets time to zero runs first, it ends the round and a guess that arrives after is no longer in the `drawing` phase, so it does not score. If the guess runs first in that same second, it scores with the `timeLeft` still on the clock, and then the tick may end the round. Players can disagree about a photo-finish. They cannot corrupt the counter, because nothing runs in parallel inside this process.

## 34. A late joiner walks in during a round. What do they see?

They get the public game state: phase, mask, time left, scores, who is drawing. They get `canvas_state` so the picture is current. They do not get the word. They do not get the drawer's options. They can guess if the phase is still `drawing` and they are not the drawer. They were not in the turn order that was shuffled at the start. The current match's order stays as it was. They are part of "connected non-drawers" for the everyone-guessed check, so their presence can keep the round going until they guess or the clock ends. That is a bit generous to the people who were already there (a new guesser can still score) and a bit strict (the round does not end early just because the original group had all guessed, if the new person has not). It matches the definition we can explain: everyone here who can guess, has guessed.

## 35. How would you add accounts, or an eraser, without throwing this out?

Accounts would sit in front of seat creation: a user id on `Player`, minted by a login step, used as the reclaim key instead of a random player id. The `Map` would still not be the place to store passwords. The game loop would not change. The design pressure would be host transfer and "this user already has a seat," which `session_taken` already sketches.

An eraser is a stroke with a composite mode, or a color that means "destination out." It has to be stored in the stroke list so undo, refresh, and late join all replay it. A bitmap eraser painted only on the drawer's canvas would desync everyone else. That is why it was left out rather than half-added: the stroke model can represent it, and the UI scope said no.

Both features are additions at a named boundary (`Player`, the stroke object), which is the reason those boundaries exist.

## 36. Why are the tests only the pure functions?

`judgeGuess` and `guesserPoints` are where a one-character change silently ruins the game, and they need no sockets, no timers, and no ports. `node:test` runs them with `npm test`. A socket-level test would boot Express, connect two clients, wait on the clock, and assert on event order. That test is valuable and it is brittle: the word is random, the timer is real, and the grace period is 20 seconds. We exercised that path by running two browsers against a live server instead of encoding it as a flaky suite. The gap is real. A regression in "non-drawer draw is ignored" would not be caught by `npm test` today.

## 37. What does the 2-minute version of this system sound like?

One Node process holds a `Map` of rooms. Each room has players and, during a match, a `Game`. The game shuffles a turn order once, offers the drawer a few words on their socket only, and broadcasts a mask to everyone else. A one-second interval is the clock. Strokes are polylines in 0–1 coordinates, stored on the server, painted locally for the drawer, and replayed for everyone else. One text box is classified by the server with an exact match and a small edit distance. Scores pay guessers for speed and the drawer a flat 50 per correct guess at the end of the round. Disconnects keep the seat for 20 seconds and pause the drawer. The React app is a reducer in front of the socket and a canvas that is not in React state. Restart the process and the rooms are gone, by design.
