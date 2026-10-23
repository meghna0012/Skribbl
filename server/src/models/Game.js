import { drawerPoints, guesserPoints } from '../logic/scoring.js';
import { judgeGuess, normalize } from '../logic/matchGuess.js';
import { pickWords } from '../logic/words.js';
import { freshReveal, formatMask, hintsDue, revealOne } from '../logic/hints.js';
import { clamp01, sanitizeColor, sanitizeSize } from '../logic/draw.js';

// How long the drawer has to pick, and how long the reveal screen stays up.
// Both are server clocks. Clients only display what these timers broadcast.
const CHOOSE_SECONDS = 15;
const ROUND_END_MS = 5000;

// What: Fisher-Yates shuffle.
// Why: turn order should not be join order, or the host always draws first.
// We copy first so the caller's array stays intact.
function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// One match inside a room. The room can outlive the game. The game cannot outlive the room.
export class Game {
  constructor(room) {
    this.room = room;
    this.phase = 'choosing';
    this.turnOrder = [];
    this.turnIndex = 0;
    this.cycleLength = 1;
    this.totalRounds = room.settings.rounds;
    this.roundNumber = 1;
    this.drawerId = null;
    this.word = null;
    this.wordOptions = [];
    this.revealed = [];
    this.hintsRevealed = 0;
    this.hintCount = room.settings.hints;
    this.drawTime = room.settings.drawTime;
    this.timeLeft = 0;
    this.chooseTimeLeft = CHOOSE_SECONDS;
    this.strokes = [];
    this.currentStroke = null;
    this.guessed = new Set();
    this.usedWords = new Set();
    this.paused = false;
    this.timer = null;
    this.endTimer = null;
    this.roundReason = null;
    this.finalResult = null;
  }

  // What: build the full turn list and start the first choice.
  // Why: "rounds" means full cycles. Each connected player draws once per round,
  // so the list is the shuffled order repeated `rounds` times. Shuffling once
  // keeps the order explainable instead of reshuffling every turn.
  start(playerIds) {
    const order = shuffle(playerIds);
    this.cycleLength = order.length;
    this.totalRounds = this.room.settings.rounds;
    this.drawTime = this.room.settings.drawTime;
    this.hintCount = this.room.settings.hints;
    this.turnOrder = [];
    for (let round = 0; round < this.totalRounds; round += 1) {
      this.turnOrder.push(...order);
    }
    this.turnIndex = 0;
    this.usedWords = new Set();
    this.beginTurn();
  }

  // What: stop the 1-second clock without cancelling the between-rounds pause.
  stopTicking() {
    clearInterval(this.timer);
    this.timer = null;
  }

  // What: stop every timer this game owns.
  // Why: abandon and game-over must not let a leftover timeout start another turn.
  stop() {
    this.stopTicking();
    clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  // What: one interval for both choosing and drawing.
  // Why: two intervals would drift apart. `tick` looks at the phase and does the right work.
  // Restarting clears the previous interval so a new turn cannot stack clocks.
  startTicking() {
    this.stopTicking();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  // What: the official clock. Clients display `timer_tick`. They do not decrement their own.
  // Why: if each browser counted down, a lagged client would end the round early.
  // While paused (drawer disconnected) we do not decrement, so the 20s grace is free time.
  tick() {
    if (this.paused) return;

    if (this.phase === 'choosing') {
      this.chooseTimeLeft -= 1;
      this.room.emit('timer_tick', { timeLeft: this.chooseTimeLeft });
      if (this.chooseTimeLeft <= 0) this.chooseWord(null);
      return;
    }

    if (this.phase !== 'drawing') return;
    this.timeLeft = Math.max(0, this.timeLeft - 1);
    this.applyHints();
    this.room.emit('timer_tick', { timeLeft: this.timeLeft });
    if (this.timeLeft <= 0) this.endRound('time');
  }

  // What: move to the next living drawer and ask them to pick a word.
  // Why: players who left are skipped instead of deleted from the array, so indexes
  // of later turns do not shift under us. Word choices go only to the drawer's socket.
  // Everyone else gets the same event without `wordOptions`.
  beginTurn() {
    while (
      this.turnIndex < this.turnOrder.length
      && !this.room.players.has(this.turnOrder[this.turnIndex])
    ) {
      this.turnIndex += 1;
    }

    if (this.room.players.size < 2) {
      this.room.abandonGame('Not enough players to continue.');
      return;
    }

    if (this.turnIndex >= this.turnOrder.length) {
      this.finish();
      return;
    }

    this.drawerId = this.turnOrder[this.turnIndex];
    this.roundNumber = Math.floor(this.turnIndex / this.cycleLength) + 1;
    this.word = null;
    this.revealed = [];
    this.wordOptions = pickWords(this.room.settings.wordCount, this.usedWords);
    this.guessed = new Set();
    this.strokes = [];
    this.currentStroke = null;
    this.hintsRevealed = 0;
    this.roundReason = null;
    this.phase = 'choosing';
    this.room.phase = 'choosing';
    this.chooseTimeLeft = CHOOSE_SECONDS;
    this.paused = !this.room.players.get(this.drawerId)?.connected;

    const payload = {
      drawerId: this.drawerId,
      drawTime: this.drawTime,
      round: this.roundNumber,
      totalRounds: this.totalRounds,
      turn: this.turnIndex + 1,
      totalTurns: this.turnOrder.length,
      chooseTime: CHOOSE_SECONDS,
    };
    const drawer = this.room.players.get(this.drawerId);
    this.room.emitExcept(drawer?.socketId, 'round_start', payload);
    this.room.emitTo(drawer?.socketId, 'round_start', {
      ...payload,
      wordOptions: this.wordOptions,
    });
    this.room.emit('canvas_state', { strokes: [] });
    this.room.emit('game_state', this.toPublic());
    this.room.emit('timer_tick', { timeLeft: this.chooseTimeLeft });
    this.startTicking();
  }

  // What: lock in the word and start the drawing clock.
  // Why: `null` means the 15s timer ran out, so we pick at random. A typed word
  // must be one of the options, otherwise a client could submit a word they were
  // never offered. The word itself is sent only on `your_word` to the drawer.
  // Guessers get the mask. The shared `game_state` never includes the word.
  chooseWord(requested) {
    if (this.phase !== 'choosing') {
      return { ok: false, error: 'Not choosing a word' };
    }

    if (this.wordOptions.length === 0) {
      return { ok: false, error: 'No words available' };
    }

    let word = null;
    if (requested == null || requested === '') {
      word = this.wordOptions[Math.floor(Math.random() * this.wordOptions.length)];
    } else {
      word = this.wordOptions.find(
        (option) => option.toLowerCase() === String(requested).trim().toLowerCase(),
      );
      if (!word) return { ok: false, error: 'Pick one of the choices' };
    }

    this.usedWords.add(word.toLowerCase());
    this.word = word;
    this.revealed = freshReveal(word);
    this.hintsRevealed = 0;
    this.phase = 'drawing';
    this.room.phase = 'drawing';
    this.timeLeft = this.drawTime;
    this.strokes = [];
    this.currentStroke = null;

    const drawer = this.room.players.get(this.drawerId);
    this.room.emitTo(drawer?.socketId, 'your_word', { word });
    this.room.emit('canvas_state', { strokes: [] });
    this.room.emit('hint_update', { mask: formatMask(word, this.revealed) });
    this.room.emit('game_state', this.toPublic());
    this.room.emit('timer_tick', { timeLeft: this.timeLeft });
    return { ok: true };
  }

  // What: open as many letters as the clock says are due, then tell the room the new mask.
  // Why: we may have jumped more than one slice if the process stalled, so the
  // loop catches up. `revealOne` returns the same array when it refuses, which
  // stops us from spinning once only one letter is left.
  applyHints() {
    const due = hintsDue(this.drawTime, this.timeLeft, this.hintCount);
    if (due <= this.hintsRevealed || !this.word) return;

    let changed = false;
    while (this.hintsRevealed < due) {
      const next = revealOne(this.word, this.revealed);
      this.hintsRevealed += 1;
      if (next === this.revealed) break;
      this.revealed = next;
      changed = true;
    }

    if (changed) {
      this.room.emit('hint_update', { mask: formatMask(this.word, this.revealed) });
    }
  }

  // What: turn one line of text into chat, a correct guess, or a private "close".
  // Why: the drawer and anyone who already scored cannot guess again, so their
  // text is chat. During choosing, the drawer is blocked from typing an option
  // into chat, which would spoil it for the room. A correct guess is announced
  // without the word. A near miss goes only to that player.
  handleText(player, text) {
    const canGuess = this.phase === 'drawing'
      && player.id !== this.drawerId
      && !this.guessed.has(player.id);

    if (this.phase === 'choosing' && player.id === this.drawerId) {
      const typed = normalize(text);
      const spoilsChoice = this.wordOptions.some((option) => normalize(option) === typed);
      if (spoilsChoice) return { ok: false, error: 'Pick the word with the buttons' };
    }

    if (!canGuess) {
      this.room.addChat(player, text);
      return { ok: true };
    }

    const result = judgeGuess(text, this.word);
    if (result === 'ignore') return { ok: true };

    if (result === 'correct') {
      const points = guesserPoints({
        timeLeft: this.timeLeft,
        drawTime: this.drawTime,
        earlierCorrect: this.guessed.size,
      });
      player.score += points;
      this.guessed.add(player.id);
      this.room.emit('guess_result', {
        correct: true,
        playerId: player.id,
        playerName: player.name,
        points,
      });
      this.room.addMessage({
        system: true,
        text: `${player.name} guessed the word!`,
      });
      this.room.emitTo(player.socketId, 'your_word', { word: this.word });
      this.room.broadcastRoster();
      this.room.emit('game_state', this.toPublic());
      this.checkAllGuessed();
      return { ok: true };
    }

    if (result === 'close') {
      this.room.emitTo(player.socketId, 'guess_result', {
        correct: false,
        close: true,
        playerId: player.id,
      });
      return { ok: true };
    }

    this.room.addChat(player, text);
    return { ok: true };
  }

  // What: end the round when every connected guesser has the word.
  // Why: disconnected seats are not required to guess. Waiting for them would
  // stall the round for the whole grace period even after everyone present is done.
  checkAllGuessed() {
    if (this.phase !== 'drawing') return;
    const guessers = [...this.room.players.values()].filter(
      (player) => player.connected && player.id !== this.drawerId,
    );
    if (guessers.length > 0 && guessers.every((player) => this.guessed.has(player.id))) {
      this.endRound('all_guessed');
    }
  }

  // What: reveal the word, pay the drawer, and schedule the next turn.
  // Why: drawer points are applied here, once, so a correct guess does not have
  // to know it is the last one. If the drawer left, they get none of those points.
  // If they never chose a word, there is nothing to reveal, so we advance immediately
  // instead of holding a 5s overlay over an empty secret.
  endRound(reason) {
    if (this.phase !== 'choosing' && this.phase !== 'drawing') return;
    this.stopTicking();

    if (!this.word) {
      this.turnIndex += 1;
      this.beginTurn();
      return;
    }

    if (reason !== 'drawer_left') {
      const drawer = this.room.players.get(this.drawerId);
      if (drawer) drawer.score += drawerPoints(this.guessed.size);
    }

    this.phase = 'roundEnd';
    this.room.phase = 'roundEnd';
    this.roundReason = reason;
    this.room.broadcastRoster();
    this.room.emit('round_end', {
      word: this.word,
      reason,
      scores: this.room.playerList(),
      nextDrawerId: this.peekNextDrawer(),
    });
    this.room.emit('game_state', this.toPublic());
    this.endTimer = setTimeout(() => {
      this.turnIndex += 1;
      this.beginTurn();
    }, ROUND_END_MS);
  }

  // What: who would draw next, skipping anyone who already left.
  // Why: the round-end overlay says "Next: Ada" without starting their turn yet.
  peekNextDrawer() {
    for (let index = this.turnIndex + 1; index < this.turnOrder.length; index += 1) {
      const playerId = this.turnOrder[index];
      if (this.room.players.has(playerId)) return playerId;
    }
    return null;
  }

  // What: end the match and publish the leaderboard.
  // Why: everyone at the top score is a winner, so a tie is not broken by who
  // joined first. `finalResult` is stored so a refresh during the results screen
  // can rebuild it without recomputing from a half-cleared game.
  finish() {
    this.stop();
    this.phase = 'gameOver';
    this.room.phase = 'gameOver';
    const leaderboard = this.room.playerList().sort(
      (a, b) => b.score - a.score || a.name.localeCompare(b.name),
    );
    const top = leaderboard[0]?.score ?? 0;
    const winners = leaderboard.filter((player) => player.score === top);
    this.finalResult = { winners, leaderboard };
    this.room.broadcastRoster();
    this.room.emit('game_state', this.toPublic());
    this.room.emit('game_over', this.finalResult);
  }

  // What: the game fields that are safe to broadcast.
  // Why: this object is the one guessers receive. It has the mask, never the word.
  // The clock shown depends on the phase so choosing and drawing share one `timeLeft`.
  toPublic() {
    return {
      phase: this.phase,
      round: this.roundNumber,
      totalRounds: this.totalRounds,
      turn: Math.min(this.turnIndex + 1, this.turnOrder.length),
      totalTurns: this.turnOrder.length,
      drawerId: this.drawerId,
      mask: this.word ? formatMask(this.word, this.revealed) : '',
      timeLeft: this.phase === 'choosing' ? this.chooseTimeLeft : this.timeLeft,
      drawTime: this.drawTime,
      guessedIds: [...this.guessed],
      paused: this.paused,
    };
  }

  // What: freeze the clock if the person who must act just disconnected.
  // Why: only the drawer's absence blocks the turn. A guesser dropping should not pause everyone.
  onDrawerDisconnect(playerId) {
    if (this.drawerId !== playerId) return;
    if (this.phase !== 'choosing' && this.phase !== 'drawing') return;
    this.paused = true;
    this.room.emit('game_state', this.toPublic());
  }

  // What: resume the clock when that drawer comes back inside the grace window.
  onDrawerReconnect(playerId) {
    if (this.drawerId !== playerId || !this.paused) return;
    this.paused = false;
    this.room.emit('game_state', this.toPublic());
  }

  // What: react after a seat is actually deleted, not merely disconnected.
  // Why: under two players, the match cannot continue. If the removed player was
  // the drawer, the round ends without paying them. If a guesser leaves and
  // everyone still here has already guessed, the round can end early.
  onPlayerRemoved(playerId) {
    this.guessed.delete(playerId);
    if (this.room.players.size < 2) {
      this.room.abandonGame('Not enough players to continue.');
      return;
    }
    if (this.drawerId === playerId && (this.phase === 'choosing' || this.phase === 'drawing')) {
      this.endRound('drawer_left');
      return;
    }
    if (this.phase === 'drawing') this.checkAllGuessed();
  }

  // What: begin a stroke and tell everyone except the drawer.
  // Why: the drawer already drew this point locally. We still store it so a
  // player who joins mid-round can replay the picture. Color and size are snapped
  // to the allowed set before they are stored or relayed.
  startStroke(player, raw) {
    if (player.id !== this.drawerId || this.phase !== 'drawing' || this.paused) return;
    const point = { x: clamp01(raw?.x), y: clamp01(raw?.y) };
    this.currentStroke = {
      color: sanitizeColor(raw?.color),
      size: sanitizeSize(raw?.size),
      points: [point],
    };
    this.strokes.push(this.currentStroke);
    this.room.emitExcept(player.socketId, 'draw_data', {
      type: 'start',
      color: this.currentStroke.color,
      size: this.currentStroke.size,
      x: point.x,
      y: point.y,
    });
  }

  // What: append one point to the open stroke.
  // Why: the client throttles to about 30ms. The server still caps the length
  // so a stuck pointer cannot grow one stroke without bound.
  addPoint(player, raw) {
    if (player.id !== this.drawerId || this.phase !== 'drawing' || !this.currentStroke) return;
    if (this.currentStroke.points.length >= 4000) return;
    const point = { x: clamp01(raw?.x), y: clamp01(raw?.y) };
    this.currentStroke.points.push(point);
    this.room.emitExcept(player.socketId, 'draw_data', {
      type: 'move',
      x: point.x,
      y: point.y,
    });
  }

  // What: close the current stroke. Viewers do not need the event to finish the line,
  // but sending it keeps both sides agreed that the stroke has ended.
  endStroke(player) {
    if (player.id !== this.drawerId || !this.currentStroke) return;
    this.currentStroke = null;
    this.room.emitExcept(player.socketId, 'draw_data', { type: 'end' });
  }

  // What: drop the last stroke and tell the other players to do the same.
  // Why: undo is "last stroke", not "last point". The drawer already popped locally,
  // so they are excluded from the broadcast.
  undo(player) {
    if (player.id !== this.drawerId || this.phase !== 'drawing') return;
    if (this.strokes.length === 0) return;
    this.strokes.pop();
    this.currentStroke = null;
    this.room.emitExcept(player.socketId, 'draw_data', { type: 'undo' });
  }

  // What: wipe every stroke. Same permission rule as undo: drawer, and only while drawing.
  clearCanvas(player) {
    if (player.id !== this.drawerId || this.phase !== 'drawing') return;
    this.strokes = [];
    this.currentStroke = null;
    this.room.emitExcept(player.socketId, 'draw_data', { type: 'clear' });
  }

  // What: a plain copy of the strokes for a player who just joined or refreshed.
  // Why: we copy points so a later move cannot mutate an object that was already queued to send.
  snapshotStrokes() {
    return this.strokes.map((stroke) => ({
      color: stroke.color,
      size: stroke.size,
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
    }));
  }
}
