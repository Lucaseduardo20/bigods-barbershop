'use strict';

/**
 * Servidor estático mínimo pras 3 SPAs (admin/booking/account) em produção.
 * Cada frontend chama a API só por caminho relativo `/api/...` (ver
 * apps/*\/src/lib/api.ts, `const BASE = '/api'`) — em dev isso é resolvido
 * pelo proxy do Vite; aqui, servindo os arquivos já compilados (sem Vite),
 * este processo é quem faz esse proxy.
 */

const path = require('node:path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, 'dist');
const API_URL = process.env.API_URL; // ex.: http://api:3000 (nome do serviço no docker-compose)

const app = express();

if (API_URL) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: API_URL,
      changeOrigin: true,
      pathRewrite: { '^/api': '' },
    }),
  );
} else {
  console.warn('[static-server] API_URL não definido — /api não terá proxy nenhum (a app vai falhar ao chamar a API).');
}

app.use(express.static(STATIC_DIR));

// Fallback de SPA: qualquer rota que não seja arquivo estático nem /api cai no index.html.
app.get('*', (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[static-server] servindo ${STATIC_DIR} na porta ${PORT}${API_URL ? ` — proxy /api → ${API_URL}` : ''}`);
});
