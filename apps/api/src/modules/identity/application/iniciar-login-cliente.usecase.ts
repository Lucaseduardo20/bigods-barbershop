import { Inject, Injectable } from '@nestjs/common';
import { Telefone } from '../../../shared/domain/telefone';
import { IDENTITY_PROVIDER, IdentityProvider } from '../domain/identity-provider';

export interface IniciarLoginClienteInput {
  companyId: string;
  telefone: string;
}

export interface IniciarLoginClienteOutput {
  desafio: string;
  expiraEm: Date;
  codigoDemo: string | null;
}

/** §3.4: inicia o login OTP por telefone do cliente final. */
@Injectable()
export class IniciarLoginClienteUseCase {
  constructor(@Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider) {}

  async executar(input: IniciarLoginClienteInput): Promise<IniciarLoginClienteOutput> {
    // Normaliza para E.164 — a mesma chave usada na reconciliação por telefone.
    const telefone = Telefone.de(input.telefone);
    const desafio = await this.identity.iniciarLogin({
      companyId: input.companyId,
      telefoneE164: telefone.e164,
    });
    return {
      desafio: desafio.desafio,
      expiraEm: desafio.expiraEm,
      codigoDemo: desafio.codigoDemo,
    };
  }
}
