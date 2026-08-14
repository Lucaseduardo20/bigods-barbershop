'use strict';

/**
 * Cognito trigger: Create Auth Challenge.
 * Gera um código OTP de 6 dígitos, ENVIA para o cliente e guarda o código
 * esperado em `privateChallengeParameters` (só o Cognito vê, nunca o cliente).
 * O código também é propagado nas próximas tentativas via `challengeMetadata`
 * para não gerar um novo a cada erro de digitação.
 *
 * CANAL DE ENVIO — WhatsApp por padrão, SMS (SNS) como fallback:
 * a barbearia já opera o OTP por WhatsApp (`services/whatsapp-otp/`, Baileys) e
 * a decisão foi manter esse canal ao adotar o Cognito — muda quem ORQUESTRA o
 * desafio (Cognito, em vez do nosso banco), não por onde o código chega ao
 * cliente. Se `WHATSAPP_OTP_SERVICE_URL`/`WHATSAPP_OTP_INTERNAL_TOKEN` não
 * estiverem configuradas, cai no SNS — o caminho que este arquivo usava antes
 * continua funcional e não foi removido.
 *
 * O contrato HTTP é o MESMO do `HttpWhatsAppOtpClient` do backend
 * (POST {baseUrl}/enviar, header `X-Internal-Token`, body `{telefone,mensagem}`),
 * e a mensagem é literalmente a mesma do `WhatsAppIdentityProvider` — o cliente
 * não percebe diferença nenhuma entre os dois caminhos.
 *
 * Falha de envio LANÇA: sem isso o Cognito apresentaria ao cliente um desafio
 * cujo código nunca chegou (o mesmo "desafio órfão" que
 * `OtpIdentityProviderBase` evita persistindo só depois do envio).
 *
 * Deploy: runtime Node.js 20.x, handler `create-auth-challenge.handler`.
 * `fetch` é global no Node 20 — o caminho de WhatsApp não tem dependência.
 * Ver README.md.
 */

const crypto = require('node:crypto');

const TTL_MINUTOS = Number(process.env.OTP_TTL_MINUTOS || '5') || 5;
const TIMEOUT_MS = Number(process.env.WHATSAPP_OTP_TIMEOUT_MS || '8000') || 8000;

exports.handler = async (event) => {
  let codigo;

  // Reaproveita o mesmo código entre tentativas do mesmo desafio.
  const anterior = (event.request.session || []).find(
    (s) => s.challengeName === 'CUSTOM_CHALLENGE' && s.challengeMetadata,
  );
  if (anterior && /^CODE-\d{6}$/.test(anterior.challengeMetadata)) {
    codigo = anterior.challengeMetadata.slice(5);
  } else {
    codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const telefone = event.request.userAttributes.phone_number;
    if (telefone) {
      await enviarCodigo(telefone, codigo);
    }
  }

  // O cliente NÃO recebe o código aqui (só pelo canal de envio). O Cognito guarda o esperado.
  event.response.publicChallengeParameters = {
    telefone: event.request.userAttributes.phone_number || '',
  };
  event.response.privateChallengeParameters = { codigo };
  event.response.challengeMetadata = `CODE-${codigo}`;

  return event;
};

async function enviarCodigo(telefoneE164, codigo) {
  const baseUrl = process.env.WHATSAPP_OTP_SERVICE_URL;
  const internalToken = process.env.WHATSAPP_OTP_INTERNAL_TOKEN;
  if (baseUrl && internalToken) {
    return enviarPorWhatsApp(baseUrl, internalToken, telefoneE164, codigo);
  }
  return enviarPorSms(telefoneE164, codigo);
}

/** Mesma mensagem e mesmo contrato do `WhatsAppIdentityProvider` do backend. */
async function enviarPorWhatsApp(baseUrl, internalToken, telefoneE164, codigo) {
  const mensagem =
    `Seu código de acesso Bigod's Barber: *${codigo}*. ` +
    `Válido por ${TTL_MINUTOS} minutos. Não compartilhe com ninguém.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resposta;
  try {
    resposta = await fetch(`${baseUrl}/enviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
      body: JSON.stringify({ telefone: telefoneE164, mensagem }),
      signal: controller.signal,
    });
  } catch (e) {
    // Lança: melhor o login falhar na cara do cliente ("tente de novo") do que
    // ele ficar digitando um código que nunca foi enviado.
    throw new Error(`Serviço de WhatsApp inacessível: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!resposta.ok) {
    throw new Error(`Serviço de WhatsApp respondeu ${resposta.status}`);
  }
}

/** Caminho anterior, mantido como fallback: SMS pelo SNS. */
async function enviarPorSms(telefoneE164, codigo) {
  // require tardio: o caminho de WhatsApp não precisa carregar o SDK da AWS.
  const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
  const sns = new SNSClient({});
  await sns.send(
    new PublishCommand({
      PhoneNumber: telefoneE164,
      Message: `Bigod's Barber: seu código de acesso é ${codigo}`,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }),
  );
}
