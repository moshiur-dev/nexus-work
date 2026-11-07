import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// On Windows a folder can be locked for a moment (EBUSY), for example by antivirus or a file indexer.
// Without an error listener the file watcher's error crashes the dev server, so log it and keep going.
const keepWatcherAlive = {
  name: 'keep-watcher-alive',
  configureServer(server) {
    server.watcher.on('error', (err) => {
      server.config.logger.warn(`File watcher: ${err.code || ''} ${err.message}`, { timestamp: true });
    });
  },
};

export default defineConfig({
  plugins: [react(), keepWatcherAlive],
  server: {
    port: 5173,
    // Forward /api calls to the Express server in development
    proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } },
  },
});
