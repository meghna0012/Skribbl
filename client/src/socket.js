import { io } from 'socket.io-client';

// One socket for the tab. autoConnect is off so useRoom can attach listeners first,
// then connect. In dev, Vite proxies this to port 3001. In production it is same-origin.
export const socket = io({
  autoConnect: false,
});
