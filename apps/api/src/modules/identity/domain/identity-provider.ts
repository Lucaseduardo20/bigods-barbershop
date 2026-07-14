import { ClienteId } from '../../../shared/domain/ids';

/**
 * Porta de provisionamento de usuário final (cliente). Hoje: fake local.
 * A integração real (Cognito) cria o usuário OTP e devolve o sub.
 */
export interface IdentityProvider {
  provisionarUsuario(clienteId: ClienteId, telefoneE164: string): Promise<string>;
}

export const IDENTITY_PROVIDER = Symbol('IdentityProvider');
