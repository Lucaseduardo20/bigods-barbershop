'use strict';

/**
 * Cognito trigger: Create Auth Challenge.
 * Gera um código OTP de 6 dígitos, ENVIA por SMS (SNS) e guarda o código
 * esperado em `privateChallengeParameters` (só o backend/Cognito veem, nunca o
 * cliente). O código também é propagado nas próximas tentativas via
 * `challengeMetadata` para não gerar um novo a cada erro.
 *
 * Deploy: runtime Node.js 20.x, handler `create-auth-challenge.handler`.
 * A role da Lambda precisa de permissão `sns:Publish`. Ver README.md.
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const crypto = require('node:crypto');

const sns = new SNSClient({});

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
      await sns.send(
        new PublishCommand({
          PhoneNumber: telefone,
          Message: `Bigod's Barber: seu código de acesso é ${codigo}`,
          MessageAttributes: {
            'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
          },
        }),
      );
    }
  }

  // O cliente NÃO recebe o código aqui (só via SMS). O Cognito guarda o esperado.
  event.response.publicChallengeParameters = { telefone: event.request.userAttributes.phone_number || '' };
  event.response.privateChallengeParameters = { codigo };
  event.response.challengeMetadata = `CODE-${codigo}`;

  return event;
};
