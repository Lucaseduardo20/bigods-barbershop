import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Porta 5175 (admin=5173, booking=5174). Proxa /api → API em :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
