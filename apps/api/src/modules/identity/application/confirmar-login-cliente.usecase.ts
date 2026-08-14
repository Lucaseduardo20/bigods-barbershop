import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Telefone } from '../../../shared/domain/telefone';
import { IDENTITY_PROVIDER, IdentityProvider } from '../domain/identity-provider';
import { SessaoDoClienteService } from './sessao-do-cliente.service';

export interface ConfirmarLoginClienteInput {
  companyId: string;
  telefone: string;
  codigo: string;
  desafio: string;
}

export interface ConfirmarLoginClienteOutput {
  token: string;
  cliente: { id: string; nome: string; telefone: string };
}

/**
 * §3.4: confirma o código OTP orquestrado pela nossa API (`IdentityProvider` —
 * demo ou WhatsApp). Prova a posse do telefone e delega a reconciliação do
 * `Cliente` + emissão da sessão para `SessaoDoClienteService`, que é o mesmo
 * ponto usado pelo caminho do Cognito/Amplify (`TrocarTokenCognitoUseCase`).
 */
@Injectable()
export class ConfirmarLoginClienteUseCase {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly sessaoDoCliente: SessaoDoClienteService,
  ) {}

  async executar(input: ConfirmarLoginClienteInput): Promise<ConfirmarLoginClienteOutput> {
    const telefone = Telefone.de(input.telefone);

    const resultado = await this.identity.confirmarLogin({
      companyId: input.companyId,
      telefoneE164: telefone.e164,
      codigo: input.codigo,
      desafio: input.desafio,
    });
    if (!resultado) {
      throw new UnauthorizedException('Código inválido ou expirado');
    }

    return this.sessaoDoCliente.reconciliarEEmitir({
      companyId: input.companyId,
      telefone,
      sub: resultado.sub,
    });
  }
}
