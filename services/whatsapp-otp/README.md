# whatsapp-otp-service

Processo Node **separado** da API principal (`apps/api`) que mantém a sessão do
WhatsApp viva — via [Baileys](https://github.com/WhiskeySockets/Baileys), que
implementa o protocolo multi-device do WhatsApp direto por WebSocket, **sem
navegador nem Chrome** — e expõe um endpoint HTTP interno mínimo: `POST
/enviar`, chamado pelo `WhatsAppIdentityProvider` do backend para mandar o
código OTP de login do cliente final.

**Por que um processo separado?** A sessão do WhatsApp (QR code, reconexão) é
instável por natureza. Se ela cair, quem cai é ESTE processo — nunca a API
principal, que continua respondendo normalmente e só passa a devolver "não foi
possível enviar o código agora" (503) enquanto este serviço estiver fora.

**Por que Baileys e não `@open-wa/wa-automate`?** A primeira versão deste
serviço usava open-wa (Puppeteer + Chrome real) — funcionava, mas a versão
gratuita da lib bloqueia mandar mensagem pra quem NÃO é contato salvo no
WhatsApp, que é exatamente o caso de uso aqui (cliente da barbearia nunca vai
estar salvo no WhatsApp descartável). Desbloquear isso na lib antiga exigia
licença paga (~£10-15/mês, sujeita a aprovação). Baileys não tem essa trava, é
gratuito (MIT), e também é mais leve (sem Chrome — build e boot bem mais
rápidos). Ver `DECISOES_PENDENTES.md` na raiz do monorepo para o histórico
completo dessa troca.

## ⚠️ Use um número DESCARTÁVEL

**Nunca conecte o número oficial da barbearia aqui.** Automatizar o WhatsApp
Web por fora do app oficial é contra os termos de uso deles — o WhatsApp pode
banir números que detecta como automatizados. Decisão do dono: usar um chip
separado, só para enviar os códigos de login. Se ele for banido, troca-se o
chip sem afetar o número real de atendimento da barbearia.

## Como rodar

**Staging/produção: use `scripts/deploy.sh staging|production` na raiz do
monorepo** (ver `DEPLOY.md`) — ele builda e sobe este serviço junto com o
resto via Docker Compose, com `restart: unless-stopped` e a sessão persistida
num volume Docker. Esta seção documenta rodar ESTE serviço isolado (útil pra
testar/depurar antes de plugar no resto, ou pra conectar o número pela
primeira vez).

### Direto (sem Docker)

```bash
cd services/whatsapp-otp
npm install

# variável obrigatória — qualquer valor aleatório longo, ex.: openssl rand -hex 32
export WHATSAPP_OTP_INTERNAL_TOKEN="<token-longo-aleatorio>"

npm start
```

### Via Docker (isolado, sem o resto do stack)

```bash
cd services/whatsapp-otp
docker build -t whatsapp-otp .
docker run -it --rm -p 3100:3100 \
  -e WHATSAPP_OTP_INTERNAL_TOKEN="<token-longo-aleatorio>" \
  -v "$(pwd)/session:/app/session" \
  whatsapp-otp
```

Nos dois casos: na **primeira execução**, um QR code em ASCII aparece no
terminal/nos logs em poucos segundos (sem precisar abrir navegador nenhum) —
escaneie com o WhatsApp do número descartável (Aparelhos conectados → Conectar
um aparelho). Depois de escaneado, a sessão fica salva em `./session` (ou no
volume Docker) e as próximas execuções **reconectam sozinhas, sem pedir QR de
novo** — não apague essa pasta, é ela que guarda o login.

## Rodando de verdade (produção, fora do Docker)

Se por algum motivo você NÃO for usar `scripts/deploy.sh` (Docker), este
processo precisa ficar sempre no ar de outro jeito — o próprio Baileys
reconecta sozinho em quedas de conexão comuns (ver lógica de
`connection.update` em `src/index.js`), mas se o PROCESSO NODE em si morrer
(crash, `kill`, reinício da máquina), algo precisa reiniciá-lo:

```bash
# com pm2 (reinicia sozinho em caso de crash)
npm install -g pm2
pm2 start src/index.js --name whatsapp-otp
pm2 save
pm2 startup   # configura o pm2 para subir no boot da máquina
```

Ou como serviço systemd equivalente, se preferir não usar pm2.

## Variáveis de ambiente

| Variável | Obrigatória | Default | Descrição |
|---|---|---|---|
| `WHATSAPP_OTP_INTERNAL_TOKEN` | **sim** | — | Token compartilhado com o backend (`WHATSAPP_OTP_INTERNAL_TOKEN` no `.env` da API) — sem ele o serviço recusa subir. Protege `/enviar` de qualquer coisa na rede interna. |
| `PORT` | não | `3100` | Porta HTTP deste serviço. |
| `WHATSAPP_SESSION_DATA_PATH` | não | `./session` | Onde a sessão autenticada (credenciais + chaves) fica persistida entre reinícios. |
| `WHATSAPP_LOG_LEVEL` | não | `silent` | Nível de log do Baileys (`pino`) — `debug` pra depurar problemas de conexão. |

## Endpoints

- `GET /status` — `{ "conectado": boolean }`. Sem autenticação (útil para
  monitoramento externo simples).
- `POST /enviar` — exige header `X-Internal-Token: <WHATSAPP_OTP_INTERNAL_TOKEN>`.
  Corpo: `{ "telefone": "+5511999998888", "mensagem": "seu código é 123456" }`.
  Responde `503` se a sessão não estiver conectada, `502` se o envio falhar,
  `200 { ok: true }` em sucesso.

## Como o backend se conecta a este serviço

No `.env` da raiz do monorepo (usado por `apps/api`):

```bash
IDENTITY_PROVIDER="whatsapp"
WHATSAPP_OTP_SERVICE_URL="http://localhost:3100"   # ou a URL onde este serviço estiver rodando
WHATSAPP_OTP_INTERNAL_TOKEN="<o MESMO token deste README>"
```

Ver `.env.example`/`.env.docker.example` na raiz do monorepo para a lista
completa e comentada.

## Troubleshooting

**QR não aparece / trava depois de "Page loaded" (só relevante se você ainda
estiver usando a versão antiga baseada em open-wa — não deveria acontecer com
Baileys):** era um problema de User-Agent desatualizado hardcoded na lib
antiga; resolvido com a migração pra Baileys, que busca a versão do protocolo
WhatsApp mais recente a cada boot (`fetchLatestBaileysVersion`).

**Erro "Not a contact" ao mandar mensagem:** isso é do open-wa (versão
antiga), não do Baileys — se você ver esse erro, confirme que
`package.json` está usando `baileys`, não `@open-wa/wa-automate`.

**Conexão cai e não reconecta sozinha:** verifique os logs — se aparecer
"Sessão DESLOGADA", o WhatsApp invalidou as credenciais (ex.: você desconectou
o aparelho pelo celular, ou trocou de número). Apague a pasta de sessão
(`WHATSAPP_SESSION_DATA_PATH`) e reinicie pra escanear o QR de novo. Qualquer
outro motivo de queda reconecta automaticamente sozinho.

**Quero ver mais detalhe do que está acontecendo:** rode com
`WHATSAPP_LOG_LEVEL=debug` pra ver os logs internos do Baileys (protocolo,
handshake, etc.) — bem mais verboso, só pra depuração.
