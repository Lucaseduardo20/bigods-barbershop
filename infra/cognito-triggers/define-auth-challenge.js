'use strict';

/**
 * Cognito trigger: Define Auth Challenge.
 * Orquestra o fluxo CUSTOM_AUTH (login por OTP, sem senha):
 *  - início / após resposta errada mas ainda com tentativas → emite CUSTOM_CHALLENGE
 *  - resposta certa → conclui (emite tokens)
 *  - excedeu o limite de tentativas → falha a autenticação
 *
 * Não precisa de dependências externas. Deploy: runtime Node.js 20.x, handler
 * `define-auth-challenge.handler`. Ver README.md.
 */

const MAX_TENTATIVAS = 3;

exports.handler = async (event) => {
  const sessao = event.request.session || [];

  const ultima = sessao.length ? sessao[sessao.length - 1] : null;

  if (ultima && ultima.challengeName === 'CUSTOM_CHALLENGE' && ultima.challengeResult === true) {
    // Código correto → autentica.
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else if (sessao.length >= MAX_TENTATIVAS) {
    // Tentativas esgotadas → falha.
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else {
    // Início ou nova tentativa → apresenta o desafio de código.
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
  }

  return event;
};
