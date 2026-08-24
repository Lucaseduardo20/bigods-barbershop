'use strict';

/**
 * Cliente do GTI SMS (https://gtisms.com) — provedor de SMS em nuvem, sem
 * aparelho no meio (2026-08-21).
 *
 * POR QUE EXISTE: o SMS Gate entrega pelo celular Android pareado da barbearia,
 * e essa perna final é instável — aparelho suspenso pelo Android, sem bateria,
 * sem Wi-Fi, e o OTP simplesmente não chega (ver "Quando o SMS não chega" no
 * README). Este provedor tira o aparelho da equação.
 *
 * ZERO DEPENDÊNCIAS, igual ao `sms-gate.js`: usa o `fetch` global do Node 20,
 * que é o runtime da Lambda. Isso mantém o deploy sendo "subir um zip com dois
 * ou três arquivos", sem empacotar node_modules.
 *
 * ⚠️ O contrato abaixo veio da DOCUMENTAÇÃO PÚBLICA do provedor, não de um
 * envio real. Antes de confiar nele em produção, faça UM envio de verdade e
 * confira o corpo da resposta — foi assim que o `sms-gate.js` foi validado
 * ("formato confirmado por PoC do dono").
 *
 *   POST https://sms.gtisms.com/api/v3/sms/send
 *   Authorization: Bearer <token>
 *   Accept: application/json
 *   Content-Type: application/json
 *   { "recipient": "5511988887777", "message": "..." }
 *
 *   sucesso → { status: "success", data: { uid, to, status, cost } }
 *   erro    → { status: "error", message: "..." }
 */

const ENDPOINT_PADRAO = 'https://sms.gtisms.com/api/v3/sms/send';
/** Curto de propósito: o cliente está esperando na tela do funil. */
const TIMEOUT_PADRAO_MS = 8000;

/**
 * Destino no formato do GTI: só dígitos, com DDI, **sem o `+`**.
 *
 * É a diferença mais fácil de errar entre os dois provedores: o SMS Gate exige
 * `+55...` e recusa sem o `+`; este quer `55...` e não entende com ele.
 */
function paraDestinoGti(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) throw new Error('Telefone vazio');
  if (digitos.length > 11 && digitos.startsWith('55')) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  throw new Error(`Telefone em formato inesperado: ${digitos.length} dígitos`);
}

class GtiSmsError extends Error {
  constructor(mensagem, causa) {
    super(mensagem);
    this.name = 'GtiSmsError';
    this.causa = causa;
  }
}

/**
 * Envia um SMS. Lança `GtiSmsError` em qualquer falha — quem chama (o trigger)
 * deixa o erro subir para o Cognito RECUSAR o login, em vez de apresentar um
 * desafio que o cliente nunca teria como responder.
 *
 * @param {{token: string, endpoint?: string, timeoutMs?: number}} config
 * @param {{telefone: string, texto: string}} mensagem
 * @returns {Promise<{id: string|null, status: string|null, custo: number|null}>}
 */
async function enviarSms(config, mensagem) {
  if (!config || !config.token) {
    throw new GtiSmsError('Token do GTI SMS ausente (GTISMS_TOKEN)');
  }

  const endpoint = config.endpoint || ENDPOINT_PADRAO;
  const timeoutMs = config.timeoutMs || TIMEOUT_PADRAO_MS;
  const recipient = paraDestinoGti(mensagem.telefone);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resposta;
  try {
    resposta = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient, message: mensagem.texto }),
      signal: controller.signal,
    });
  } catch (e) {
    const motivo =
      e && e.name === 'AbortError' ? `sem resposta em ${timeoutMs}ms` : String(e && e.message ? e.message : e);
    throw new GtiSmsError(`Falha ao falar com o GTI SMS: ${motivo}`, e);
  } finally {
    clearTimeout(timer);
  }

  const corpo = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const detalhe = corpo && corpo.message ? `: ${String(corpo.message).slice(0, 200)}` : '';
    throw new GtiSmsError(`GTI SMS recusou o envio (HTTP ${resposta.status})${detalhe}`);
  }

  // ★ Erro com HTTP 200. O provedor sinaliza falha no CORPO (`status: "error"`),
  // e não só no código HTTP — saldo esgotado e número inválido chegam assim.
  // Olhar só o `resposta.ok` faria uma falha de envio passar por sucesso, e o
  // cliente ficaria esperando um código que nunca saiu.
  if (!corpo || corpo.status !== 'success') {
    const detalhe = corpo && corpo.message ? String(corpo.message).slice(0, 200) : 'sem detalhe';
    throw new GtiSmsError(`GTI SMS não enviou: ${detalhe}`);
  }

  const dados = corpo.data || {};
  return {
    id: dados.uid ? String(dados.uid) : null,
    status: dados.status ? String(dados.status) : null,
    custo: typeof dados.cost === 'number' ? dados.cost : null,
  };
}

module.exports = { enviarSms, paraDestinoGti, GtiSmsError, ENDPOINT_PADRAO };
