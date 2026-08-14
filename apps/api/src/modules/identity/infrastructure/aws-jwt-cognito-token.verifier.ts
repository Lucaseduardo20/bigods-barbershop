import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  ClienteVerificado,
  CognitoTokenVerifier,
} from '../domain/cognito-token-verifier';

export interface CognitoTokenVerifierConfig {
  userPoolId: string;
  /** App client (público, sem secret) que o front usa no Amplify. */
  clientId: string;
}

/** Assinatura mínima que usamos do verificador — permite mock nos testes sem tocar a rede. */
export interface VerificadorJwt {
  verify(token: string): Promise<Record<string, unknown>>;
}

/**
 * Verificação real do `idToken` do Cognito via `aws-jwt-verify` (lib oficial da
 * AWS): baixa e cacheia o JWKS do User Pool sozinha e confere assinatura,
 * `iss`, `aud`, `exp` e `token_use`. Nada disso é implementado à mão aqui —
 * validação de JWT escrita na mão é exatamente o tipo de código que quebra em
 * silêncio e vira falha de autenticação.
 *
 * O verificador é injetado para os testes poderem passar um mock: nenhum teste
 * automatizado busca JWKS na internet.
 */
export class AwsJwtCognitoTokenVerifier implements CognitoTokenVerifier {
  private readonly verificador: VerificadorJwt;

  constructor(config: CognitoTokenVerifierConfig, verificador?: VerificadorJwt) {
    this.verificador =
      verificador ??
      (CognitoJwtVerifier.create({
        userPoolId: config.userPoolId,
        tokenUse: 'id',
        clientId: config.clientId,
      }) as unknown as VerificadorJwt);
  }

  async verificar(idToken: string): Promise<ClienteVerificado | null> {
    if (!idToken) return null;
    let payload: Record<string, unknown>;
    try {
      payload = await this.verificador.verify(idToken);
    } catch {
      // Assinatura inválida, expirado, audiência errada, JWKS inacessível —
      // tudo é "não autenticado" para quem chamou. Nunca vaza o motivo.
      return null;
    }

    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    const telefone = typeof payload.phone_number === 'string' ? payload.phone_number : null;
    // Sem telefone no token não há como reconciliar com o `Cliente` (a
    // identidade natural do cliente final é o telefone, §3.1) — recusa em vez
    // de inventar um cliente sem número.
    if (!sub || !telefone) return null;

    return { sub, telefoneE164: telefone };
  }
}
