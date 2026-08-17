import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Porta 5174 (o admin usa 5173). Ambos proxam /api → API em :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Escape hatch para o limite de inotify do sistema
    // (fs.inotify.max_user_watches). Num monorepo com o VS Code aberto, o teto
    // pode estar todo consumido pelo editor, e aí o Vite morre no boot com
    // ENOSPC. Com POLLING=1 o watcher passa a fazer varredura por tempo, que
    // não usa inotify nenhum:
    //
    //   POLLING=1 npm run env:up
    //
    // É mais pesado de CPU — use só enquanto o limite não for corrigido de
    // verdade (sysctl) ou o editor não parar de vigiar node_modules.
    watch: process.env.POLLING ? { usePolling: true, interval: 400 } : undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
