/**
 * Porta de verificação do token que o CLIENTE traz do Cognito. TypeScript puro.
 *
 * Existe por causa do experimento "Amplify no funil": quando o navegador
 * autentica DIRETO no Cognito (Amplify `signIn`/`confirmSignIn`), quem prova a
 * posse do telefone é a AWS, não a nossa API — mas todo o resto do sistema
 * (`@ContaCliente()`, `ClienteSessaoService`) continua falando a nossa sessão
 * HMAC. Esta porta é a ponte: recebe o `idToken` do Cognito, devolve quem é.
 *
 * Não confundir com `IdentityProvider` (que ORQUESTRA o desafio OTP do lado do
 * servidor). Aqui o desafio já aconteceu inteiro fora — só resta conferir a
 * assinatura de quem diz ter passado por ele.
 */

export interface ClienteVerificado {
  /** `sub` do Cognito → vira/confere `Cliente.cognitoSub`. */
  sub: string;
  /** `phone_number` do token, já em E.164 (o Cognito guarda assim). */
  telefoneE164: string;
}

export interface CognitoTokenVerifier {
  /**
   * Valida assinatura (JWKS), emissor, audiência, expiração e `token_use=id`.
   * Devolve `null` para qualquer token que não passe — a borda decide o HTTP,
   * mesmo padrão de `IdentityProvider.confirmarLogin` e `AuthProvider`.
   */
  verificar(idToken: string): Promise<ClienteVerificado | null>;
}

export const COGNITO_TOKEN_VERIFIER = Symbol('CognitoTokenVerifier');
