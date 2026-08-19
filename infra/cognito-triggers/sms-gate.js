'use strict';

/**
 * Cliente do SMS Gate Cloud (https://sms-gate.app) — envio de SMS pelo celular
 * Android da barbearia, que fica pareado com o serviço em nuvem.
 *
 * ZERO DEPENDÊNCIAS de propósito: usa o `fetch` global do Node 20+, que é o
 * runtime da Lambda. Isso faz o deploy ser "colar dois arquivos no console da
 * AWS" em vez de empacotar `node_modules` num zip — importa porque quem publica
 * é o dono, não uma esteira de CI.
 *
 * Este módulo é `require`-ado pelo trigger `create-auth-challenge`, e é testado
 * isoladamente (`apps/api/test/integration/sms-gate.spec.ts`) com `fetch`
 * mockado — nenhum teste automatizado dispara SMS de verdade (cada SMS custa e
 * gasta a franquia do chip).
 *
 * Formato da API confirmado por PoC do dono:
 *   POST https://api.sms-gate.app/3rdparty/v1/messages
 *   Authorization: Basic base64(usuario:senha)
 *   { "textMessage": { "text": "..." }, "phoneNumbers": ["+55DDDNUMERO"] }
 *
 * ⚠️ SEM criptografia ponta-a-ponta (decisão do dono, 2026-08-18): o texto e o
 * telefone trafegam em claro até o device. É aceitável aqui porque o conteúdo é
 * um código de 6 dígitos com validade curta e uso único; se um dia o conteúdo
 * mudar (link, dado pessoal), reavaliar.
 */

const ENDPOINT_PADRAO = 'https://api.sms-gate.app/3rdparty/v1/messages';
/** Curto de propósito: o cliente está esperando na tela do funil. */
const TIMEOUT_PADRAO_MS = 8000;

/**
 * Normaliza para E.164 brasileiro (+55DDDNUMERO). O Cognito guarda o telefone
 * já em E.164, mas normalizar de novo aqui é barato e protege contra um número
 * que entre por outro caminho — o SMS Gate recusa (ou entrega errado) qualquer
 * formato diferente.
 */
function paraE164(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) throw new Error('Telefone vazio');
  // Já veio com o código do país.
  if (digitos.length > 11 && digitos.startsWith('55')) return `+${digitos}`;
  // 10 (fixo/antigo) ou 11 (celular com o 9) dígitos = número nacional.
  if (digitos.length === 10 || digitos.length === 11) return `+55${digitos}`;
  throw new Error(`Telefone em formato inesperado: ${digitos.length} dígitos`);
}

class SmsGateError extends Error {
  constructor(mensagem, causa) {
    super(mensagem);
    this.name = 'SmsGateError';
    this.causa = causa;
  }
}

/**
 * Envia um SMS. Lança `SmsGateError` em qualquer falha — quem chama (o trigger)
 * deixa o erro subir para o Cognito RECUSAR o login, em vez de apresentar um
 * desafio que o cliente nunca teria como responder (o mesmo princípio de
 * "nunca um desafio órfão" que o `OtpIdentityProviderBase` já segue no monólito).
 *
 * @param {{usuario: string, senha: string, endpoint?: string, timeoutMs?: number}} config
 * @param {{telefone: string, texto: string}} mensagem
 * @returns {Promise<{id: string|null, state: string|null}>} eco do que o cloud aceitou
 */
async function enviarSms(config, mensagem) {
  if (!config || !config.usuario || !config.senha) {
    throw new SmsGateError('Credenciais do SMS Gate ausentes (SMS_GATE_USER / SMS_GATE_PASSWORD)');
  }

  const endpoint = config.endpoint || ENDPOINT_PADRAO;
  const timeoutMs = config.timeoutMs || TIMEOUT_PADRAO_MS;
  const telefone = paraE164(mensagem.telefone);
  const credencial = Buffer.from(`${config.usuario}:${config.senha}`).toString('base64');

  // AbortController: sem timeout, um SMS Gate lento seguraria a Lambda até o
  // limite dela, e o cliente ficaria olhando a tela travada.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resposta;
  try {
    resposta = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credencial}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        textMessage: { text: mensagem.texto },
        phoneNumbers: [telefone],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    // Timeout, DNS, TLS, rede — tudo cai aqui com mensagem limpa.
    const motivo = e && e.name === 'AbortError' ? `sem resposta em ${timeoutMs}ms` : String(e && e.message ? e.message : e);
    throw new SmsGateError(`Falha ao falar com o SMS Gate: ${motivo}`, e);
  } finally {
    clearTimeout(timer);
  }

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    // 401 aqui é quase sempre credencial errada; 4xx/5xx o resto.
    throw new SmsGateError(
      `SMS Gate recusou o envio (HTTP ${resposta.status})${corpo ? `: ${corpo.slice(0, 200)}` : ''}`,
    );
  }

  // O corpo traz o id e o estado inicial da mensagem. NÃO tratamos o estado
  // como "entregue": o 2xx significa que o CLOUD aceitou e enfileirou. Se o
  // celular estiver offline, a mensagem fica pendente e o SMS nunca chega —
  // ver a nota sobre device offline no README.
  const dados = await resposta.json().catch(() => null);
  return {
    id: dados && dados.id ? String(dados.id) : null,
    state: dados && dados.state ? String(dados.state) : null,
  };
}

module.exports = { enviarSms, paraE164, SmsGateError, ENDPOINT_PADRAO };
