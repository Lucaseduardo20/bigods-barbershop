import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Telefone } from '../../../shared/domain/telefone';
import { IdentityProvider } from '../domain/identity-provider';

/** Token do `CognitoIdentityProvider` usado SÓ para provisionar (experimento Amplify). */
export const COGNITO_IDENTITY_PROVIDER = Symbol('CognitoIdentityProviderParaProvisionamento');

export interface ProvisionarUsuarioCognitoInput {
  companyId: string;
  telefone: string;
}

/**
 * Experimento "Amplify no funil": garante que o telefone exista no User Pool
 * ANTES do navegador chamar `signIn`.
 *
 * Por que é preciso: no caminho tradicional quem provisiona é
 * `IniciarLoginClienteUseCase` (a API é quem fala com o provider). Com o
 * Amplify o navegador fala direto com o Cognito, e o Cognito não cria usuário
 * sozinho — um telefone que nunca comprou nada cairia em `UserNotFound` (ou,
 * pior, num desafio falso que nunca entrega código, com
 * `PreventUserExistenceErrors` ligado). Este endpoint fecha esse buraco
 * reusando o `provisionarUsuario` que o `CognitoIdentityProvider` já
 * implementa (idempotente, `AdminCreateUser` + senha aleatória permanente).
 *
 * Exposição equivalente à que já existe: `/conta/login/iniciar` também
 * provisiona qualquer telefone informado, sob o mesmo rate limit.
 */
@Injectable()
export class ProvisionarUsuarioCognitoUseCase {
  constructor(
    @Optional()
    @Inject(COGNITO_IDENTITY_PROVIDER)
    private readonly cognito: IdentityProvider | null,
  ) {}

  async executar(input: ProvisionarUsuarioCognitoInput): Promise<void> {
    if (!this.cognito) {
      throw new ServiceUnavailableException('Login via Cognito não está habilitado nesta instalação');
    }
    const telefone = Telefone.de(input.telefone);
    await this.cognito.provisionarUsuario({
      companyId: input.companyId,
      telefoneE164: telefone.e164,
    });
  }
}
