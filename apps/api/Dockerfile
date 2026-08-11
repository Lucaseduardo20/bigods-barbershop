# Build a partir da RAIZ do monorepo (contexto = raiz), porque a API depende
# de @bigods/contracts (workspace npm) — precisa do repo inteiro pra resolver.
#   docker build -f apps/api/Dockerfile .
FROM node:20-bookworm-slim AS build
WORKDIR /repo

# Prisma precisa do OpenSSL instalado explicitamente nesta base — sem isto ele
# ainda funciona, mas avisa que não detectou a versão certa da libssl.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Só os manifestos primeiro — cacheia a camada de `npm ci` entre builds
# enquanto só código-fonte muda (sem mexer em dependência).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/booking/package.json apps/booking/package.json
COPY apps/account/package.json apps/account/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/config/package.json packages/config/package.json
RUN npm ci

COPY . .

# Prisma Client PRIMEIRO — o build TS da API importa os tipos gerados
# (`@prisma/client`), então sem isto o `tsc` falha com "no exported member".
# Gerado já na MESMA imagem base do runtime: o binário da query engine
# precisa ser compatível com o SO onde vai rodar de verdade.
RUN npx prisma generate --schema prisma/schema.prisma

# turbo resolve a ordem de build sozinho (contracts antes de api, por dependência).
RUN npx turbo run build --filter=@bigods/api...

# ---- Runtime: só o que precisa pra rodar, sem fonte TS/testes/.git ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/contracts ./packages/contracts
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/prisma ./prisma

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
