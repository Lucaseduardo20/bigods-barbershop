# Contexto = este diretório (services/whatsapp-otp), fora do workspace npm de
# propósito — dependências isoladas do resto.
#   docker build -f services/whatsapp-otp/Dockerfile services/whatsapp-otp
#
# Baileys implementa o protocolo do WhatsApp direto por WebSocket — SEM
# navegador/Chrome — então esta imagem é só Node puro, bem mais leve do que
# a versão anterior (baseada em Puppeteer/Chrome).
FROM node:20-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY src ./src

# Sessão autenticada do WhatsApp — monte um volume aqui pra sobreviver a
# recriações do container (senão cada `docker compose up --build` pede QR de novo).
ENV WHATSAPP_SESSION_DATA_PATH=/app/session
VOLUME ["/app/session"]

EXPOSE 3100
CMD ["node", "src/index.js"]
