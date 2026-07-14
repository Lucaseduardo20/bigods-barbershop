import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Porta 5174 (o admin usa 5173). Ambos proxam /api → API em :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
