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
 * cria os lançamentos imutáveis no ledger. Para SERVIÇOS, valorBase =
 * valorCobrado do item (já é o rateado quando a origem é pacote) e o
 * percentual vem da matriz barbeiro×serviço. Para PRODUTOS (item 4a da
 * sessão 2026-07-16, add-on vendido junto do atendimento), valorBase =
 * unitário×quantidade e o percentual é o único `comissaoProdutos` do
 * barbeiro — sem matriz por produto (decisão consciente).
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
      const lancamento = LancamentoComissao.criarDeServico({
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

    for (const produto of evento.produtos) {
      const valorBase = Dinheiro.deCentavos(produto.valorUnitarioCentavos).multiplicarPorInteiro(produto.quantidade);
      const lancamento = LancamentoComissao.criarDeProduto({
        id: randomUUID(),
        companyId: evento.companyId,
        barbeiroId: evento.barbeiroId,
        atendimentoId: evento.atendimentoId,
        produtoId: produto.produtoId,
        valorBase,
        percentualAplicado: barbeiro.comissaoProdutos,
        ocorridoEm: evento.ocorridoEm,
      });
      await this.lancamentos.salvar(lancamento);
    }
  }
}
