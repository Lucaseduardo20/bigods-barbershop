# Build a partir da RAIZ do monorepo (contexto = raiz) — o account depende de
# @bigods/contracts (workspace npm).
#   docker build -f apps/account/Dockerfile --build-arg VITE_COMPANY_ID=bigods --build-arg VITE_BOOKING_URL=https://agendar.suabarbearia.com .
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
# em runtime. Passe via --build-arg (ou VITE_COMPANY_ID/VITE_BOOKING_URL do docker-compose).
ARG VITE_COMPANY_ID=bigods
ARG VITE_BOOKING_URL=
ENV VITE_COMPANY_ID=${VITE_COMPANY_ID}
ENV VITE_BOOKING_URL=${VITE_BOOKING_URL}
RUN npx turbo run build --filter=@bigods/account...

# ---- Runtime: só os arquivos estáticos compilados + o servidor mínimo ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY docker/static-server/package.json docker/static-server/package-lock.json ./
RUN npm ci --omit=dev
COPY docker/static-server/server.js ./server.js
COPY --from=build /repo/apps/account/dist ./dist

ENV STATIC_DIR=/app/dist
ENV PORT=5175
EXPOSE 5175
CMD ["node", "server.js"]
