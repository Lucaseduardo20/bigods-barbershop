# Build a partir da RAIZ do monorepo (contexto = raiz) — o booking depende de
# @bigods/contracts (workspace npm).
#   docker build -f apps/booking/Dockerfile --build-arg VITE_COMPANY_ID=bigods .
FROM node:20-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/booking/package.json apps/booking/package.json
COPY apps/account/package.json apps/account/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
RUN npm ci

COPY . .

# Vite EMBUTE essas variáveis no JS final no momento do build — não são lidas
# em runtime. Passe via --build-arg (ou o VITE_COMPANY_ID do docker-compose).
ARG VITE_COMPANY_ID=bigods
ENV VITE_COMPANY_ID=${VITE_COMPANY_ID}
RUN npx turbo run build --filter=@bigods/booking...

# ---- Runtime: só os arquivos estáticos compilados + o servidor mínimo ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY docker/static-server/package.json docker/static-server/package-lock.json ./
RUN npm ci --omit=dev
COPY docker/static-server/server.js ./server.js
COPY --from=build /repo/apps/booking/dist ./dist

ENV STATIC_DIR=/app/dist
ENV PORT=5174
EXPOSE 5174
CMD ["node", "server.js"]
