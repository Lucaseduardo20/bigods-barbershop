import { Inject, Injectable } from '@nestjs/common';
import { Telefone } from '../../../shared/domain/telefone';
import {
  FinalidadeDoCodigo,
  IDENTITY_PROVIDER,
  IdentityProvider,
} from '../domain/identity-provider';

export interface IniciarLoginClienteInput {
  companyId: string;
  telefone: string;
  /** Só auditoria — ver `FinalidadeDoCodigo`. */
  finalidade?: FinalidadeDoCodigo;
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
    // Bug 2: login por telefone não pode depender de já ter comprado um pacote
    // (isso deixava quem só agendou avulso, ou nunca comprou nada, preso num
    // código que nunca chegava). Provisiona a identidade aqui, na hora do
    // login, para qualquer telefone — idempotente nos dois providers — e o
    // código sempre é emitido de verdade. A neutralidade fica só em nunca
    // revelar existência de conta NESTA etapa (a resposta é idêntica sempre);
    // "não tem conta/pacote" só aparece depois, já com a posse do telefone
    // provada pelo código (ver ConfirmarLoginClienteUseCase).
    await this.identity.provisionarUsuario({ companyId: input.companyId, telefoneE164: telefone.e164 });
    const desafio = await this.identity.iniciarLogin({
      companyId: input.companyId,
      telefoneE164: telefone.e164,
      finalidade: input.finalidade,
    });
    return {
      desafio: desafio.desafio,
      expiraEm: desafio.expiraEm,
      codigoDemo: desafio.codigoDemo,
    };
  }
}
