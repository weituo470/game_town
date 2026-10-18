import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const target = `http://127.0.0.1:${process.env.PORT || 2567}`;
export default defineConfig({
  plugins: [react()], base: './', build: {
    manifest: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks(id) {
      // Keep the stable graphics engine cacheable across choreography updates.
      if (id.replaceAll('\\', '/').includes('/node_modules/three/')) return 'three-engine';
    } } },
  },
  server: { proxy: {
    '/api': { target },
    '/matchmake': { target },
    '^/[A-Za-z0-9_-]{8,32}/[A-Za-z0-9_-]{8,32}': { target, ws: true },
  } },
});
