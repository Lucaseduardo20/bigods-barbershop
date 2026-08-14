import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomBytes } from 'node:crypto';
import {
  ConfirmarLoginInput,
  DesafioLogin,
  IdentityProvider,
  IniciarLoginInput,
  ProvisionarUsuarioInput,
  ResultadoConfirmacao,
} from '../domain/identity-provider';

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  /** Minutos que o código dura do lado do usuário (só para exibição na UI). */
  ttlMinutos: number;
}

/**
 * Provider de identidade real via AWS Cognito, login SEM SENHA por telefone
 * usando o fluxo **Custom Auth Challenge** (CUSTOM_AUTH) — o mais portável e o
 * que roda em qualquer tier de User Pool. O código OTP é gerado/enviado pelos
 * Lambda triggers do lado da AWS (ver `infra/cognito-triggers/`), não aqui.
 *
 * O `CognitoIdentityProviderClient` é injetado para permitir mock nos testes —
 * nenhum teste automatizado toca a AWS de verdade.
 *
 * Fluxo:
 *  - provisionarUsuario → AdminCreateUser (idempotente) + senha permanente
 *    aleatória (só para deixar o usuário CONFIRMED; nunca é usada — login é OTP).
 *  - iniciarLogin       → InitiateAuth(CUSTOM_AUTH) → devolve a Session (desafio).
 *  - confirmarLogin     → RespondToAuthChallenge(CUSTOM_CHALLENGE) → tokens → sub.
 */
export class CognitoIdentityProvider implements IdentityProvider {
  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly config: CognitoConfig,
  ) {}

  async provisionarUsuario(input: ProvisionarUsuarioInput): Promise<void> {
    try {
      await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.config.userPoolId,
          Username: input.telefoneE164,
          MessageAction: 'SUPPRESS', // nada de e-mail/SMS de boas-vindas
          UserAttributes: [
            { Name: 'phone_number', Value: input.telefoneE164 },
            { Name: 'phone_number_verified', Value: 'true' },
          ],
        }),
      );
      // Senha permanente aleatória: transiciona o usuário para CONFIRMED (exigido
      // pelo CUSTOM_AUTH). Nunca é usada para login — o login é sempre por OTP.
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.config.userPoolId,
          Username: input.telefoneE164,
          Password: `A1!${randomBytes(24).toString('base64url')}`,
          Permanent: true,
        }),
      );
    } catch (e) {
      // Idempotência: usuário já existe → ok.
      if (this.ehErro(e, 'UsernameExistsException')) return;
      throw e;
    }
  }

  async iniciarLogin(input: IniciarLoginInput): Promise<DesafioLogin> {
    const expiraEm = new Date(Date.now() + this.config.ttlMinutos * 60_000);
    try {
      const resp = await this.client.send(
        new InitiateAuthCommand({
          AuthFlow: 'CUSTOM_AUTH',
          ClientId: this.config.clientId,
          AuthParameters: { USERNAME: input.telefoneE164 },
        }),
      );
      // `Session` é o token opaco que amarra iniciar↔confirmar (o "desafio").
      return { desafio: resp.Session ?? '', expiraEm, codigoDemo: null };
    } catch (e) {
      // Defensivo, não gate de envio: `IniciarLoginClienteUseCase` provisiona o
      // usuário ANTES de chamar aqui, então na prática este ramo não é o
      // caminho de um telefone novo — ele só cobre corrida/estado inconsistente
      // no User Pool. O contrato da porta é claro: envio vale pra qualquer
      // telefone (ver `identity-provider.ts`).
      if (this.ehErro(e, 'UserNotFoundException')) {
        return { desafio: '', expiraEm, codigoDemo: null };
      }
      throw e;
    }
  }

  async confirmarLogin(input: ConfirmarLoginInput): Promise<ResultadoConfirmacao | null> {
    if (!input.desafio) return null;
    try {
      const resp = await this.client.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.config.clientId,
          ChallengeName: 'CUSTOM_CHALLENGE',
          Session: input.desafio,
          ChallengeResponses: { USERNAME: input.telefoneE164, ANSWER: input.codigo },
        }),
      );
      const idToken = resp.AuthenticationResult?.IdToken;
      if (!idToken) return null; // código errado devolve novo Session, sem tokens
      const sub = this.subDoIdToken(idToken);
      return sub ? { sub } : null;
    } catch (e) {
      // Código errado/expirado / tentativas esgotadas → falha de auth.
      if (this.ehErro(e, 'NotAuthorizedException') || this.ehErro(e, 'CodeMismatchException')) {
        return null;
      }
      throw e;
    }
  }

  /** Extrai o `sub` do payload do IdToken (JWT) sem validar assinatura — o token veio direto do Cognito. */
  private subDoIdToken(idToken: string): string | null {
    const partes = idToken.split('.');
    if (partes.length !== 3 || !partes[1]) return null;
    try {
      const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  private ehErro(e: unknown, nome: string): boolean {
    return typeof e === 'object' && e !== null && (e as { name?: string }).name === nome;
  }
}
