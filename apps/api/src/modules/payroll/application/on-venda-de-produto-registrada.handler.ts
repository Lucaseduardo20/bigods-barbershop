import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import {
  LANCAMENTO_COMISSAO_REPOSITORY,
  LancamentoComissaoRepository,
} from '../domain/lancamento-comissao.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { VendaDeProdutoRegistrada } from '../../products/domain/venda-de-produto.events';
import { Dinheiro } from '../../../shared/domain/dinheiro';

/**
 * Item 4b da sessão 2026-07-16: venda avulsa de produto (sem Atendimento)
 * gera comissão do mesmo jeito que o add-on — percentual único
 * `comissaoProdutos` do barbeiro, sem matriz por produto.
 */
@Injectable()
export class OnVendaDeProdutoRegistradaHandler {
  private readonly logger = new Logger(OnVendaDeProdutoRegistradaHandler.name);

  constructor(
    @Inject(LANCAMENTO_COMISSAO_REPOSITORY)
    private readonly lancamentos: LancamentoComissaoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
  ) {}

  @OnEvent('VendaDeProdutoRegistrada')
  async handle(evento: VendaDeProdutoRegistrada): Promise<void> {
    // Idempotência: reprocessar o mesmo evento não duplica lançamentos
    const existentes = await this.lancamentos.porVendaDeProduto(evento.vendaId);
    if (existentes.length > 0) return;

    const barbeiro = await this.barbeiros.porId(evento.barbeiroId);
    if (!barbeiro) {
      this.logger.error(`Barbeiro ${evento.barbeiroId} não encontrado — comissão não gerada`);
      return;
    }

    for (const item of evento.itens) {
      const valorBase = Dinheiro.deCentavos(item.valorUnitarioCentavos).multiplicarPorInteiro(item.quantidade);
      const lancamento = LancamentoComissao.criarDeProduto({
        id: randomUUID(),
        companyId: evento.companyId,
        barbeiroId: evento.barbeiroId,
        vendaDeProdutoId: evento.vendaId,
        produtoId: item.produtoId,
        valorBase,
        percentualAplicado: barbeiro.comissaoProdutos,
        ocorridoEm: evento.vendidoEm,
      });
      await this.lancamentos.salvar(lancamento);
    }
  }
}
