import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Vale } from '../domain/vale.aggregate';
import { VALE_REPOSITORY, ValeRepository } from '../domain/vale.repository';

export interface AprovarValeInput {
  valeId: string;
  companyId: string;
  decididoPorId: string;
  agora: Date;
}

/**
 * PENDENTE → APROVADO: autoriza, mas o dinheiro AINDA não saiu — o ledger só
 * é afetado na transição APROVADO→PAGO (`MarcarValePagoUseCase`).
 */
@Injectable()
export class AprovarValeUseCase {
  constructor(@Inject(VALE_REPOSITORY) private readonly vales: ValeRepository) {}

  async executar(input: AprovarValeInput): Promise<Vale> {
    const vale = await this.vales.porId(input.valeId);
    if (!vale || vale.companyId !== input.companyId) {
      throw new NotFoundException('Vale não encontrado');
    }
    vale.aprovar(input.decididoPorId, input.agora);
    await this.vales.salvar(vale);
    return vale;
  }
}
