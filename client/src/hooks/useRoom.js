import { useEffect, useReducer } from 'react';
import { socket } from '../socket.js';

// sessionStorage, not localStorage. A refresh in this tab should reclaim the seat.
// A brand-new tab should not silently jump into yesterday's room.
const SESSION_KEY = 'skribbl-session';

// What: read the last seat this tab was in.
// Why: the server identifies a reconnect by player id. The socket id is new after a refresh.
export function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

// What: remember the seat and put the room code in the URL.
// Why: the URL is the invite link. Writing it on join means a refresh still has `?room=`.
function saveSession(data) {
  const me = data.players?.find((player) => player.id === data.playerId);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    roomId: data.roomId,
    playerId: data.playerId,
    name: me?.name || '',
  }));
  const url = new URL(window.location.href);
  url.searchParams.set('room', data.roomId);
  window.history.replaceState(null, '', url);
}

// What: forget the seat and drop the code from the URL.
// Why: Leave, and "opened in another tab", must not auto-rejoin on the next connect.
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}

const initialState = {
  error: '',
  busy: false,
  booting: false,
  roomId: '',
  playerId: '',
  hostId: '',
  phase: 'home',
  settings: null,
  players: [],
  game: null,
  messages: [],
  wordOptions: [],
  yourWord: '',
  roundEnd: null,
  gameOver: null,
  canvasCmd: null,
  browseRooms: [],
};

// What: one reducer for the whole room.
// Why: socket handlers fire outside React renders. A reducer keeps every server event
// as a named transition, instead of a dozen useState setters closing over stale state.
// Strokes are not stored here. They would re-render the whole tree on every pointer move.
function reducer(state, action) {
  switch (action.type) {
    case 'busy':
      return { ...state, busy: true, error: '' };
    case 'boot_done':
      return { ...state, booting: false };
    case 'ack_ok':
      return { ...state, busy: false, booting: false };
    case 'error':
      return {
        ...state,
        busy: false,
        booting: false,
        error: action.message || 'Something went wrong',
      };
    case 'clear_error':
      return { ...state, error: '' };
    case 'reset':
      return { ...initialState, error: action.message || '' };
    case 'joined': {
      const data = action.data;
      return {
        ...state,
        busy: false,
        booting: false,
        error: '',
        roomId: data.roomId,
        playerId: data.playerId,
        hostId: data.hostId,
        settings: data.settings,
        players: data.players,
        phase: data.phase,
        messages: data.messages || [],
        game: data.phase === 'lobby' ? null : data.game,
        wordOptions: data.wordOptions || [],
        yourWord: data.yourWord || '',
        roundEnd: data.roundEnd,
        gameOver: data.gameOver,
        canvasCmd: { type: 'load', strokes: data.strokes || [], id: crypto.randomUUID() },
      };
    }
    case 'roster': {
      const next = {
        ...state,
        players: action.data.players ?? state.players,
        hostId: action.data.hostId ?? state.hostId,
        settings: action.data.settings ?? state.settings,
        phase: action.data.phase ?? state.phase,
      };
      if (action.data.phase === 'lobby') {
        next.game = null;
        next.roundEnd = null;
        next.gameOver = null;
        next.yourWord = '';
        next.wordOptions = [];
      }
      return next;
    }
    case 'game_state':
      if (action.game.phase === 'lobby') {
        return {
          ...state,
          phase: 'lobby',
          game: null,
          roundEnd: null,
          gameOver: null,
          yourWord: '',
          wordOptions: [],
          canvasCmd: { type: 'load', strokes: [], id: crypto.randomUUID() },
        };
      }
      return {
        ...state,
        phase: action.game.phase || state.phase,
        game: { ...(state.game || {}), ...action.game },
      };
    case 'round_start':
      return {
        ...state,
        phase: 'choosing',
        roundEnd: null,
        gameOver: null,
        yourWord: '',
        wordOptions: action.data.wordOptions || [],
        game: {
          ...(state.game || {}),
          phase: 'choosing',
          drawerId: action.data.drawerId,
          drawTime: action.data.drawTime,
          round: action.data.round,
          totalRounds: action.data.totalRounds,
          turn: action.data.turn,
          totalTurns: action.data.totalTurns,
          timeLeft: action.data.chooseTime,
          mask: '',
          guessedIds: [],
          paused: false,
        },
        canvasCmd: { type: 'load', strokes: [], id: crypto.randomUUID() },
      };
    case 'timer':
      if (!state.game) return state;
      return { ...state, game: { ...state.game, timeLeft: action.timeLeft } };
    case 'hint':
      if (!state.game) return state;
      return { ...state, game: { ...state.game, mask: action.mask } };
    case 'your_word':
      return { ...state, yourWord: action.word };
    case 'round_end':
      return {
        ...state,
        phase: 'roundEnd',
        roundEnd: action.data,
        wordOptions: [],
        yourWord: action.data.word || '',
        players: action.data.scores || state.players,
        game: state.game ? { ...state.game, phase: 'roundEnd', timeLeft: 0 } : state.game,
      };
    case 'game_over':
      return {
        ...state,
        phase: 'gameOver',
        roundEnd: null,
        gameOver: action.data,
        wordOptions: [],
        players: action.data.leaderboard || state.players,
      };
    case 'chat':
      return { ...state, messages: [...state.messages, action.message].slice(-80) };
    // "Close" is private. The server told only us, so we add the line locally
    // instead of waiting for a chat broadcast that will never come.
    case 'close':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: crypto.randomUUID(), system: true, text: 'Very close!' },
        ].slice(-80),
      };
    case 'canvas':
      return { ...state, canvasCmd: action.cmd };
    case 'browse':
      return { ...state, browseRooms: action.rooms || [] };
    default:
      return state;
  }
}

// What: the only place the UI talks to the socket.
// Why: screens stay dumb. They read this object and call the functions on it.
// They do not know event names.
export function useRoom() {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    booting: Boolean(loadSession()),
  });

  useEffect(() => {
    // Rejoin only when this tab already has a seat and the URL is not a different room.
    // A shared invite link should show the join form, not pull us back into the old game.
    function onConnect() {
      socket.emit('list_rooms');
      const session = loadSession();
      const queryRoom = new URLSearchParams(window.location.search).get('room');
      if (!session || (queryRoom && queryRoom.toUpperCase() !== session.roomId)) {
        dispatch({ type: 'boot_done' });
        return;
      }
      dispatch({ type: 'busy' });
      socket.emit('join_room', {
        roomId: session.roomId,
        playerName: session.name,
        playerId: session.playerId,
      }, (res) => {
        if (!res?.ok) {
          sessionStorage.removeItem(SESSION_KEY);
          dispatch({ type: 'error', message: res?.error || 'Could not rejoin' });
        }
      });
    }

    socket.on('connect', onConnect);
    socket.on('room_joined', (data) => {
      saveSession(data);
      dispatch({ type: 'joined', data });
    });
    socket.on('player_joined', (data) => dispatch({ type: 'roster', data }));
    socket.on('player_left', (data) => dispatch({ type: 'roster', data }));
    socket.on('room_update', (data) => dispatch({ type: 'roster', data }));
    socket.on('game_state', (game) => dispatch({ type: 'game_state', game }));
    socket.on('round_start', (data) => dispatch({ type: 'round_start', data }));
    socket.on('timer_tick', ({ timeLeft }) => dispatch({ type: 'timer', timeLeft }));
    socket.on('hint_update', ({ mask }) => dispatch({ type: 'hint', mask }));
    socket.on('your_word', ({ word }) => dispatch({ type: 'your_word', word }));
    socket.on('round_end', (data) => dispatch({ type: 'round_end', data }));
    socket.on('game_over', (data) => dispatch({ type: 'game_over', data }));
    socket.on('chat_message', (message) => dispatch({ type: 'chat', message }));
    socket.on('guess_result', (data) => {
      if (data.close) dispatch({ type: 'close' });
    });
    socket.on('canvas_state', ({ strokes }) => {
      dispatch({
        type: 'canvas',
        cmd: { type: 'load', strokes: strokes || [], id: crypto.randomUUID() },
      });
    });
    socket.on('draw_data', (data) => {
      dispatch({ type: 'canvas', cmd: { ...data, id: crypto.randomUUID() } });
    });
    socket.on('room_list', (payload) => {
      dispatch({ type: 'browse', rooms: payload?.rooms || [] });
    });
    socket.on('session_taken', ({ message }) => {
      clearSession();
      dispatch({ type: 'reset', message });
    });
    socket.on('error', (payload) => {
      if (payload && typeof payload.message === 'string' && !payload.stack) {
        dispatch({ type: 'error', message: payload.message });
      }
    });
    socket.on('connect_error', () => {
      dispatch({ type: 'error', message: 'Cannot reach the server' });
    });

    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      [
        'connect',
        'room_joined',
        'player_joined',
        'player_left',
        'room_update',
        'game_state',
        'round_start',
        'timer_tick',
        'hint_update',
        'your_word',
        'round_end',
        'game_over',
        'chat_message',
        'guess_result',
        'canvas_state',
        'draw_data',
        'room_list',
        'session_taken',
        'error',
        'connect_error',
      ].forEach((event) => socket.off(event));
    };
  }, []);

  useEffect(() => {
    if (!state.error) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: 'clear_error' }), 4200);
    return () => window.clearTimeout(timer);
  }, [state.error]);

  useEffect(() => {
    document.title = state.roomId ? ` · ${state.roomId}` : 'Skribbl';
  }, [state.roomId]);

  // What: send an event and surface the server's ack as a toast.
  // Why: validation errors (full room, not the host) come back on the ack.
  // We connect first if the socket is still down, then send once.
  function emit(event, payload) {
    const send = () => {
      socket.emit(event, payload, (res) => {
        if (!res?.ok) dispatch({ type: 'error', message: res?.error || 'Something went wrong' });
        else dispatch({ type: 'ack_ok' });
      });
    };
    if (socket.connected) send();
    else {
      socket.connect();
      socket.once('connect', send);
    }
  }

  // Clear any old seat first so the connect handler does not rejoin that room
  // and then also create a new one.
  function createRoom(hostName, settings) {
    sessionStorage.removeItem(SESSION_KEY);
    dispatch({ type: 'busy' });
    emit('create_room', { hostName, settings });
  }

  // Pass the stored player id only when the code matches that session.
  // Joining a different room must not try to reclaim a seat that is not in it.
  function joinRoom(playerName, roomId) {
    const code = roomId.trim().toUpperCase();
    const session = loadSession();
    dispatch({ type: 'busy' });
    emit('join_room', {
      roomId: code,
      playerName,
      playerId: session?.roomId === code ? session.playerId : undefined,
    });
  }

  function leaveRoom() {
    const finish = () => {
      clearSession();
      dispatch({ type: 'reset' });
    };
    if (!socket.connected) {
      finish();
      return;
    }
    socket.emit('leave_room', {}, finish);
  }

  // The label on the button is a hint. The server still classifies the text.
  // We send `guess` only when this player is allowed to score, so the common path is obvious.
  function sendText(text) {
    const guessed = state.game?.guessedIds?.includes(state.playerId);
    const canGuess = state.phase === 'drawing'
      && state.game?.drawerId !== state.playerId
      && !guessed;
    emit(canGuess ? 'guess' : 'chat', { text });
  }

  // Map the canvas's own event names onto the socket names from the brief.
  // No ack: a stroke should not wait for the server before the next point.
  function emitDraw(event) {
    const names = {
      start: 'draw_start',
      move: 'draw_move',
      end: 'draw_end',
      undo: 'draw_undo',
      clear: 'canvas_clear',
    };
    const name = names[event.type];
    if (name) socket.emit(name, event);
  }

  return {
    ...state,
    isHost: Boolean(state.hostId && state.hostId === state.playerId),
    isDrawer: Boolean(state.game?.drawerId && state.game.drawerId === state.playerId),
    connectedCount: state.players.filter((player) => player.connected).length,
    clearError: () => dispatch({ type: 'clear_error' }),
    createRoom,
    joinRoom,
    refreshBrowse: () => emit('list_rooms', {}),
    leaveRoom,
    setReady: (ready) => emit('player_ready', { ready }),
    updateSettings: (settings) => emit('update_settings', settings),
    startGame: () => emit('start_game', {}),
    returnToLobby: () => emit('return_lobby', {}),
    chooseWord: (word) => emit('word_chosen', { word }),
    sendText,
    emitDraw,
  };
}
