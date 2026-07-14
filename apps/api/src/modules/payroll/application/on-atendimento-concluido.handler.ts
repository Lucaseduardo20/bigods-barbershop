import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import {
  LANCAMENTO_COMISSAO_REPOSITORY,
  LancamentoComissaoRepository,
} from '../domain/lancamento-comissao.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { AtendimentoConcluido } from '../../scheduling/domain/atendimento.events';
import { Dinheiro } from '../../../shared/domain/dinheiro';

/**
 * Payroll (§2.3): a conclusão do atendimento emite evento; este handler
 * cria os lançamentos imutáveis no ledger. valorBase = valorCobrado do item
 * (já é o rateado quando a origem é pacote).
 */
@Injectable()
export class OnAtendimentoConcluidoHandler {
  private readonly logger = new Logger(OnAtendimentoConcluidoHandler.name);

  constructor(
    @Inject(LANCAMENTO_COMISSAO_REPOSITORY)
    private readonly lancamentos: LancamentoComissaoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
  ) {}

  @OnEvent('AtendimentoConcluido')
  async handle(evento: AtendimentoConcluido): Promise<void> {
    // Idempotência: reprocessar o mesmo evento não duplica lançamentos
    const existentes = await this.lancamentos.porAtendimento(evento.atendimentoId);
    if (existentes.length > 0) return;

    const barbeiro = await this.barbeiros.porId(evento.barbeiroId);
    if (!barbeiro) {
      this.logger.error(`Barbeiro ${evento.barbeiroId} não encontrado — comissão não gerada`);
      return;
    }

    for (const item of evento.itens) {
      const lancamento = LancamentoComissao.criar({
        id: randomUUID(),
        companyId: evento.companyId,
        barbeiroId: evento.barbeiroId,
        atendimentoId: evento.atendimentoId,
        servicoId: item.servicoId,
        valorBase: Dinheiro.deCentavos(item.valorCobradoCentavos),
        percentualAplicado: barbeiro.percentualPara(item.servicoId),
        ocorridoEm: evento.ocorridoEm,
      });
      await this.lancamentos.salvar(lancamento);
    }
  }
}
