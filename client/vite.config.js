import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev runs the UI on 5173 and the API on 3001. The proxy makes the browser
// talk to one origin, so Socket.IO does not need a cross-origin setup in development.
// strictPort fails loudly if 5173 is taken instead of silently moving the app.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5000,
    strictPort: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
