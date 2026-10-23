import { attachSocket } from './socket.js';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The built React app sits next to this package so one process can serve both.
// A separate static host would need its own WebSocket server anyway.
const clientDist = path.resolve(__dirname, '../../client/dist');
const port = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');

// What: a tiny liveness check for the host (Render, Railway).
// Why: the platform needs an HTTP route. Socket.IO alone is not a health check.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Socket.IO must share this HTTP server. A second port would mean two deploys.
const httpServer = createServer(app);
const io = new Server(httpServer, {
  // Dev may call the API directly from Vite's origin. Production is same-origin,
  // so this list only matters when CLIENT_ORIGIN is set.
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(',') || ['http://localhost:5173'],
  },
});

attachSocket(io);

app.use(express.static(clientDist));
// What: send index.html for any other GET, so a refresh on /?room=CODE still loads the app.
// Why: this is a single-page app. API and socket paths are left alone so they are not
// replaced with HTML.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (error) => {
    if (error) {
      res.status(404).type('text/plain').send('Build the client first with npm run build.');
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Scribble server listening on ${port}`);
});
