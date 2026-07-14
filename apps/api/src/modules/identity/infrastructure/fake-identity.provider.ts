import { Injectable } from '@nestjs/common';
import { IdentityProvider } from '../domain/identity-provider';
import { ClienteId } from '../../../shared/domain/ids';

/** Substituto local do Cognito: gera um "sub" determinístico. */
@Injectable()
export class FakeIdentityProvider implements IdentityProvider {
  async provisionarUsuario(clienteId: ClienteId, _telefoneE164: string): Promise<string> {
    return `local-${clienteId}`;
  }
}
