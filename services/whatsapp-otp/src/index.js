'use strict';

/**
 * Serviço separado que mantém a sessão do WhatsApp (via
 * [Baileys](https://github.com/WhiskeySockets/Baileys) — implementa o
 * protocolo multi-device do WhatsApp direto por WebSocket, SEM navegador/
 * Chrome) e expõe um endpoint HTTP interno mínimo: `POST /enviar`, chamado
 * pelo `WhatsAppIdentityProvider` do backend para mandar o código OTP de
 * login do cliente final.
 *
 * Histórico (ver DECISOES_PENDENTES.md): a primeira versão deste serviço
 * usava `@open-wa/wa-automate` (Puppeteer + Chrome real). Funcionava, mas a
 * versão gratuita da lib bloqueia mandar mensagem pra quem não é CONTATO
 * salvo no WhatsApp — exatamente o caso de uso daqui (cliente nunca vai
 * estar salvo no WhatsApp descartável da barbearia). Desbloquear isso na
 * lib antiga custava uma licença paga (~£10-15/mês) sujeita a aprovação.
 * Baileys não tem essa trava, é gratuito (MIT) e mais leve (sem Chrome).
 *
 * **Por que um processo separado?** A sessão do WhatsApp (QR code,
 * reconexão) é instável por natureza. Se ela cair, quem cai é ESTE
 * processo — nunca a API principal, que continua respondendo normalmente e
 * só passa a devolver "não foi possível enviar o código agora" (503)
 * enquanto este serviço estiver fora.
 */

import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from 'baileys';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';

const PORT = Number(process.env.PORT || 3100);
const SESSION_DATA_PATH = process.env.WHATSAPP_SESSION_DATA_PATH || './session';
const INTERNAL_TOKEN = process.env.WHATSAPP_OTP_INTERNAL_TOKEN;
const LOG_LEVEL = process.env.WHATSAPP_LOG_LEVEL || 'silent'; // 'debug' pra depurar

if (!INTERNAL_TOKEN) {
  // Falha fechada: sem o token, qualquer coisa na rede interna mandaria
  // mensagem pelo número da barbearia — mesmo princípio do resto do sistema
  // (webhook do AbacatePay recusa subir sem segredo de assinatura).
  console.error(
    '[whatsapp-otp] WHATSAPP_OTP_INTERNAL_TOKEN é obrigatório. Defina um valor aleatório longo antes de iniciar.',
  );
  process.exit(1);
}

const logger = pino({ level: LOG_LEVEL });

let sock = null;
let conectado = false;

/**
 * Descobre o JID REAL do número, perguntando ao WhatsApp — nunca montando
 * `${digitos}@s.whatsapp.net` por conta própria.
 *
 * Por que isso importa (e por que era um bug silencioso): número de celular
 * brasileiro tem o problema do nono dígito. O E.164 que guardamos é
 * +55 11 9XXXX-XXXX, mas o JID real de contas mais antigas costuma ser sem o 9
 * (55 11 XXXX-XXXX). Mandar para um JID que não existe **não dá erro**: o
 * Baileys aceita, responde OK, e a mensagem simplesmente não chega em lugar
 * nenhum. Do nosso lado tudo "funcionava" — inclusive o desafio era gravado no
 * banco — e o cliente ficava esperando um código que nunca vinha.
 *
 * `onWhatsApp` devolve o JID canônico e se o número existe. Número que não
 * existe no WhatsApp passa a ser um erro explícito, em vez de um buraco negro.
 */
async function resolverJid(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) throw new Error('telefone vazio ou inválido');

  const [achado] = (await sock.onWhatsApp(digitos)) || [];
  if (!achado || !achado.exists) return null;

  const ingenuo = `${digitos}@s.whatsapp.net`;
  if (achado.jid !== ingenuo) {
    // Vale log: é exatamente o caso do nono dígito, e sem isso a diferença
    // entre "número certo" e "número que não recebe nada" fica invisível.
    console.log(`[whatsapp-otp] JID canônico difere do número informado: ${ingenuo} -> ${achado.jid}`);
  }
  return achado.jid;
}

async function iniciarClienteWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DATA_PATH);
  // Busca a versão do protocolo WA mais recente a cada boot — evita o tipo de
  // travamento por versão desatualizada que já enfrentamos com a lib antiga.
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(
        '[whatsapp-otp] escaneie o QR abaixo com o WhatsApp do número DESCARTÁVEL da barbearia (nunca o oficial):',
      );
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'open') {
      conectado = true;
      console.log('[whatsapp-otp] sessão do WhatsApp conectada e pronta para enviar.');
    }

    if (connection === 'close') {
      conectado = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const deslogado = statusCode === DisconnectReason.loggedOut;
      console.log(
        `[whatsapp-otp] conexão fechada (código: ${statusCode ?? 'desconhecido'}). ` +
          (deslogado
            ? `Sessão DESLOGADA — apague a pasta "${SESSION_DATA_PATH}" e reinicie pra escanear o QR de novo.`
            : 'Reconectando automaticamente...'),
      );
      if (!deslogado) {
        iniciarClienteWhatsApp();
      }
    }
  });
}

const app = express();
app.use(express.json());

app.get('/status', (_req, res) => {
  res.json({ conectado });
});

app.use((req, res, next) => {
  if (req.path === '/status') return next();
  if (req.headers['x-internal-token'] !== INTERNAL_TOKEN) {
    return res.status(401).json({ erro: 'token interno inválido' });
  }
  next();
});

app.post('/enviar', async (req, res) => {
  if (!conectado || !sock) {
    return res.status(503).json({ erro: 'sessão do WhatsApp não está conectada agora' });
  }
  const { telefone, mensagem } = req.body || {};
  if (!telefone || !mensagem) {
    return res.status(400).json({ erro: 'telefone e mensagem são obrigatórios' });
  }
  try {
    const jid = await resolverJid(telefone);
    if (!jid) {
      // 422, não 502: não adianta "tentar de novo em instantes" — esse número
      // não vai receber nunca. A API traduz isso para o cliente conferir o
      // número digitado.
      console.warn(`[whatsapp-otp] número sem WhatsApp, nada enviado: ${telefone}`);
      return res.status(422).json({ erro: 'numero-sem-whatsapp' });
    }
    await sock.sendMessage(jid, { text: mensagem });
    res.json({ ok: true });
  } catch (e) {
    console.error('[whatsapp-otp] falha ao enviar mensagem:', e);
    res.status(502).json({ erro: 'falha ao enviar mensagem pelo WhatsApp' });
  }
});

app.listen(PORT, () => {
  console.log(`[whatsapp-otp] HTTP interno ouvindo na porta ${PORT}`);
});

iniciarClienteWhatsApp().catch((e) => {
  console.error('[whatsapp-otp] falha ao iniciar a sessão do WhatsApp:', e);
  process.exit(1);
});
