import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), { name: 'privacy-route', configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      if (request.url && /^\/privacy\/?(?:\?|$)/.test(request.url)) {
        request.url = request.url.replace(/^\/privacy\/?/, '/privacy.html');
      }
      next();
    });
  } }],
  build: { outDir: 'dist/client', emptyOutDir: true,
    rollupOptions: { input: { main: 'index.html', privacy: 'privacy.html' } },
  },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/socket.io': { target: 'http://127.0.0.1:3001', ws: true },
    },
  },
});
