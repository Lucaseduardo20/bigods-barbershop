import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Vale } from '../domain/vale.aggregate';
import { VALE_REPOSITORY, ValeRepository } from '../domain/vale.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';

export interface SolicitarValeInput {
  companyId: string;
  barbeiroId: string;
  valorCentavos: number;
  motivo?: string;
  agora: Date;
}

/**
 * FASE 1 (sessão de vale/pagamento): barbeiro solicita adiantamento de
 * comissão. Nasce PENDENTE — NÃO afeta o ledger (dinheiro só se move na
 * transição APROVADO→PAGO, ver `MarcarValePagoUseCase`).
 */
@Injectable()
export class SolicitarValeUseCase {
  constructor(@Inject(VALE_REPOSITORY) private readonly vales: ValeRepository) {}

  async executar(input: SolicitarValeInput): Promise<Vale> {
    const vale = Vale.solicitar({
      id: randomUUID(),
      companyId: input.companyId,
      barbeiroId: input.barbeiroId,
      valor: Dinheiro.deCentavos(input.valorCentavos),
      motivo: input.motivo,
      solicitadoEm: input.agora,
    });
    await this.vales.salvar(vale);
    return vale;
  }
}
