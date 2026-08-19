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
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';

/**
 * Item 4b da sessão 2026-07-16: venda avulsa de produto (sem Atendimento) gera
 * comissão do mesmo jeito que o add-on.
 *
 * A taxa vem da EMPRESA (2026-08-19, decisão dos sócios), não mais do barbeiro:
 * produto é revenda, e a margem não comporta a taxa de serviço nem faz sentido
 * variar por profissional. Ver DOMAIN.md §3.9.1.
 */
@Injectable()
export class OnVendaDeProdutoRegistradaHandler {
  private readonly logger = new Logger(OnVendaDeProdutoRegistradaHandler.name);

  constructor(
    @Inject(LANCAMENTO_COMISSAO_REPOSITORY)
    private readonly lancamentos: LancamentoComissaoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
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

    // A taxa é lida AGORA, no momento da venda, e congelada em cada lançamento
    // (§3.5). Mudar a taxa depois não mexe em nada já lançado.
    const taxaDaEmpresa = await this.parametros.comissaoProdutos(evento.companyId);

    for (const item of evento.itens) {
      const valorBase = Dinheiro.deCentavos(item.valorUnitarioCentavos).multiplicarPorInteiro(item.quantidade);
      const lancamento = LancamentoComissao.criarDeProduto({
        id: randomUUID(),
        companyId: evento.companyId,
        barbeiroId: evento.barbeiroId,
        vendaDeProdutoId: evento.vendaId,
        produtoId: item.produtoId,
        valorBase,
        percentualAplicado: taxaDaEmpresa,
        ocorridoEm: evento.vendidoEm,
      });
      await this.lancamentos.salvar(lancamento);
    }
  }
}
