'use strict';

/**
 * Cognito trigger: Create Auth Challenge.
 *
 * Gera o código OTP de 6 dígitos, ENVIA por SMS através do SMS Gate (celular
 * Android da barbearia) e guarda o código esperado em
 * `privateChallengeParameters` — que só o Cognito e o Verify enxergam, nunca o
 * cliente. O código é propagado entre tentativas via `challengeMetadata` para
 * um erro de digitação não gerar (e não custar) um SMS novo.
 *
 * ★ FONTE DE VERDADE DO CÓDIGO: é AQUI. Com `IDENTITY_PROVIDER=cognito`, a
 * nossa base (`DemoDesafioLogin`) não guarda desafio nenhum — quem gera,
 * guarda e confere é o Cognito, via estes triggers. Isso evita dois sistemas de
 * código competindo. Ver RELATORIO_SESSAO.md.
 *
 * Deploy: runtime Node.js 20.x, handler `create-auth-challenge.handler`.
 * SEM dependências externas (usa o `fetch` global do Node 20) — o zip é só este
 * arquivo + `sms-gate.js`. Env vars: SMS_GATE_USER, SMS_GATE_PASSWORD
 * (opcionais: SMS_GATE_ENDPOINT, SMS_GATE_TIMEOUT_MS). Ver README.md.
 */

const crypto = require('node:crypto');
const { enviarSms } = require('./sms-gate');

/** Minutos que o código vale — só compõe o texto; quem expira de fato é o Cognito. */
const VALIDADE_MINUTOS = 10;

function textoDoSms(codigo) {
  return `Bigod's Barber: seu codigo de acesso e ${codigo}. Vale por ${VALIDADE_MINUTOS} minutos. Nao compartilhe.`;
}

exports.handler = async (event) => {
  const sessao = event.request.session || [];

  // Reaproveita o código da tentativa anterior: errar a digitação não pode
  // disparar outro SMS (custa dinheiro e queima franquia do chip).
  const anterior = sessao.find(
    (s) => s.challengeName === 'CUSTOM_CHALLENGE' && s.challengeMetadata,
  );

  let codigo;
  if (anterior && /^CODE-\d{6}$/.test(anterior.challengeMetadata)) {
    codigo = anterior.challengeMetadata.slice(5);
  } else {
    codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const telefone = event.request.userAttributes.phone_number;
    if (!telefone) {
      // Sem telefone não há como entregar o código. Falhar aqui é melhor que
      // apresentar um desafio impossível de responder.
      throw new Error('Usuário sem phone_number — impossível enviar o OTP');
    }
    // Deixa o erro SUBIR: o Cognito recusa o InitiateAuth e a nossa API devolve
    // erro pro funil. Nunca existe desafio sem código entregue.
    await enviarSms(
      {
        usuario: process.env.SMS_GATE_USER,
        senha: process.env.SMS_GATE_PASSWORD,
        endpoint: process.env.SMS_GATE_ENDPOINT,
        timeoutMs: process.env.SMS_GATE_TIMEOUT_MS ? Number(process.env.SMS_GATE_TIMEOUT_MS) : undefined,
      },
      { telefone, texto: textoDoSms(codigo) },
    );
  }

  // O cliente NÃO recebe o código aqui — só por SMS. `publicChallengeParameters`
  // é visível pra quem chamou a API, então só vai o telefone mascarado, o
  // suficiente pra UI dizer "enviamos para •••• 1234".
  event.response.publicChallengeParameters = {
    telefone: mascarar(event.request.userAttributes.phone_number || ''),
  };
  event.response.privateChallengeParameters = { codigo };
  event.response.challengeMetadata = `CODE-${codigo}`;

  return event;
};

/** +5511998887777 → ••••7777 */
function mascarar(e164) {
  const d = String(e164).replace(/\D/g, '');
  return d.length >= 4 ? `••••${d.slice(-4)}` : '';
}
