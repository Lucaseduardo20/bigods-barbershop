import { Papel } from '@bigods/contracts';
import { BarbeiroId, CompanyId } from '../../../shared/domain/ids';

export interface UsuarioAutenticado {
  barbeiroId: BarbeiroId;
  companyId: CompanyId;
  nome: string;
  papeis: Papel[];
}

/**
 * Porta de autenticação. Hoje: LocalAuthProvider (login/senha + token HMAC).
 * A integração real com Cognito será plugada por esta mesma interface.
 */
export interface AuthProvider {
  validarCredenciais(login: string, senha: string): Promise<UsuarioAutenticado | null>;
  emitirToken(usuario: UsuarioAutenticado): string;
  verificarToken(token: string): UsuarioAutenticado | null;
}

export const AUTH_PROVIDER = Symbol('AuthProvider');
