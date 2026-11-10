import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mediaPageID } from './src/games/media-route';

export default defineConfig({
  plugins: [react(), { name: 'static-page-routes', configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url && /^\/privacy\/?(?:\?|$)/.test(request.url)) {
        request.url = request.url.replace(/^\/privacy\/?/, '/privacy.html');
      } else if (request.url) {
        const query = request.url.indexOf('?');
        const pathname = query === -1 ? request.url : request.url.slice(0, query);
        if (mediaPageID(pathname)) request.url = '/media.html' + (query === -1 ? '' : request.url.slice(query));
      }
      next();
    });
  } }],
  build: { outDir: 'dist/client', emptyOutDir: true,
    rollupOptions: { input: { main: 'index.html', privacy: 'privacy.html', media: 'media.html' } },
  },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
    },
  },
});
