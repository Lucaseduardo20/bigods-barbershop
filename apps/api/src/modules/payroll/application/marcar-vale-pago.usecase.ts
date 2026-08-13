import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';

export interface MarcarValePagoInput {
  valeId: string;
  companyId: string;
  pagoPorId: string;
  agora: Date;
}

/**
 * APROVADO → PAGO: regra crítica da FASE 1 — o débito no ledger nasce SÓ
 * aqui, nunca na aprovação (dinheiro que não saiu não é lançamento). Vale e
 * LancamentoComissao são dois agregados que precisam mudar juntos ou nenhum
 * dos dois — por isso a transação (CLAUDE.md regra 8, mesmo padrão de
 * `ConfirmarReembolsoUseCase`).
 */
@Injectable()
export class MarcarValePagoUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: MarcarValePagoInput): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const vale = await repos.vales.porId(input.valeId);
      if (!vale || vale.companyId !== input.companyId) {
        throw new NotFoundException('Vale não encontrado');
      }
      vale.marcarPago(input.pagoPorId, input.agora);

      const lancamento = LancamentoComissao.criarDeVale({
        id: randomUUID(),
        companyId: vale.companyId,
        barbeiroId: vale.barbeiroId,
        valeId: vale.id,
        registradoPorId: input.pagoPorId,
        valor: vale.valor,
        ocorridoEm: input.agora,
      });

      await repos.vales.salvar(vale);
      await repos.lancamentosComissao.salvar(lancamento);
    });
  }
}
