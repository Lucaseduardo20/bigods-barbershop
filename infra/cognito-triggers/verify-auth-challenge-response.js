'use strict';

/**
 * Cognito trigger: Verify Auth Challenge Response.
 * Compara a resposta do usuário (o código digitado) com o código esperado que o
 * Create Auth Challenge guardou em `privateChallengeParameters`. Comparação em
 * tempo constante para não vazar por timing.
 *
 * Deploy: runtime Node.js 20.x, handler `verify-auth-challenge-response.handler`.
 */

const crypto = require('node:crypto');

function igualConstante(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

exports.handler = async (event) => {
  const esperado = event.request.privateChallengeParameters
    ? event.request.privateChallengeParameters.codigo
    : undefined;
  const informado = event.request.challengeAnswer;

  event.response.answerCorrect = Boolean(esperado) && igualConstante(informado, esperado);

  return event;
};
