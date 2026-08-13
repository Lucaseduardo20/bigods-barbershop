import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Vale } from '../domain/vale.aggregate';
import { VALE_REPOSITORY, ValeRepository } from '../domain/vale.repository';

export interface NegarValeInput {
  valeId: string;
  companyId: string;
  decididoPorId: string;
  motivo: string;
  agora: Date;
}

/** PENDENTE → NEGADO (final). Nunca afeta o ledger. */
@Injectable()
export class NegarValeUseCase {
  constructor(@Inject(VALE_REPOSITORY) private readonly vales: ValeRepository) {}

  async executar(input: NegarValeInput): Promise<Vale> {
    const vale = await this.vales.porId(input.valeId);
    if (!vale || vale.companyId !== input.companyId) {
      throw new NotFoundException('Vale não encontrado');
    }
    vale.negar(input.decididoPorId, input.motivo, input.agora);
    await this.vales.salvar(vale);
    return vale;
  }
}
