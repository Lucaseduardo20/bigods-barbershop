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
import { LinhaComissionavel, ratearDesconto } from '../domain/rateio-de-desconto';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';

/**
 * Payroll (§2.3): a conclusão do atendimento emite evento; este handler
 * cria os lançamentos imutáveis no ledger. Para SERVIÇOS, valorBase =
 * valorCobrado do item (já é o rateado quando a origem é pacote) e o
 * percentual vem da matriz barbeiro×serviço. Para PRODUTOS (item 4a da
 * sessão 2026-07-16, add-on vendido junto do atendimento — inclui o que entrou
 * pelo order-bump do funil), valorBase = unitário×quantidade e o percentual é a
 * taxa ÚNICA DA EMPRESA (2026-08-19, decisão dos sócios), não a do barbeiro:
 * produto é revenda. Ver DOMAIN.md §3.9.1.
 */
@Injectable()
export class OnAtendimentoConcluidoHandler {
  private readonly logger = new Logger(OnAtendimentoConcluidoHandler.name);

  constructor(
    @Inject(LANCAMENTO_COMISSAO_REPOSITORY)
    private readonly lancamentos: LancamentoComissaoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
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

    // As linhas comissionáveis são coletadas enquanto os lançamentos nascem: é
    // sobre ELAS que o desconto do fechamento será rateado, com o percentual de
    // cada uma — o mesmo que acabou de ser congelado no lançamento.
    const linhasComissionaveis: { valorBaseCentavos: number; percentualBp: number }[] = [];

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
      linhasComissionaveis.push({
        valorBaseCentavos: lancamento.valorBase!.centavos,
        percentualBp: lancamento.percentualAplicado!.pontosBase,
      });
      await this.lancamentos.salvar(lancamento);
    }

    // Taxa lida AGORA, na conclusão, e congelada em cada lançamento (§3.5):
    // mudar a taxa depois não mexe em nada já lançado. Só consulta se houver
    // produto — atendimento só de serviço é o caso comum e não paga essa ida ao
    // banco.
    const taxaDaEmpresa = evento.produtos.length
      ? await this.parametros.comissaoProdutos(evento.companyId)
      : null;

    for (const produto of evento.produtos) {
      const valorBase = Dinheiro.deCentavos(produto.valorUnitarioCentavos).multiplicarPorInteiro(produto.quantidade);
      const lancamento = LancamentoComissao.criarDeProduto({
        id: randomUUID(),
        companyId: evento.companyId,
        barbeiroId: evento.barbeiroId,
        atendimentoId: evento.atendimentoId,
        produtoId: produto.produtoId,
        valorBase,
        percentualAplicado: taxaDaEmpresa!,
        ocorridoEm: evento.ocorridoEm,
      });
      linhasComissionaveis.push({
        valorBaseCentavos: valorBase.centavos,
        percentualBp: taxaDaEmpresa!.pontosBase,
      });
      await this.lancamentos.salvar(lancamento);
    }

    await this.lancarAjustesDoFechamento(evento, linhasComissionaveis);
  }

  /**
   * FASE 3 (2026-08-25): caixinha e desconto viram lançamentos PRÓPRIOS.
   *
   * Poderiam ser embutidos — somar a caixinha na comissão do serviço, reduzir a
   * base pelo desconto — e o saldo daria o mesmo. Mas o barbeiro veria o número
   * dele mudar sem nada explicando por quê, e desconfiança sobre dinheiro é
   * cara. Como linhas separadas, o extrato lê:
   *
   *     Comissão corte simples + barba      R$ 28,34
   *     Caixinha                          + R$  7,00
   *     Desconto concedido (sua parte)     − R$  4,50
   */
  private async lancarAjustesDoFechamento(
    evento: AtendimentoConcluido,
    linhasComissionaveis: LinhaComissionavel[],
  ): Promise<void> {
    if (evento.caixinhaCentavos > 0) {
      await this.lancamentos.salvar(
        LancamentoComissao.criarDeCaixinha({
          id: randomUUID(),
          companyId: evento.companyId,
          barbeiroId: evento.barbeiroId,
          atendimentoId: evento.atendimentoId,
          valor: Dinheiro.deCentavos(evento.caixinhaCentavos),
          ocorridoEm: evento.ocorridoEm,
        }),
      );
    }

    if (evento.descontoConcedidoCentavos > 0) {
      const rateio = ratearDesconto(evento.descontoConcedidoCentavos, linhasComissionaveis);
      // Parte do barbeiro pode ser ZERO — barbeiro a 0% de comissão, ou comanda
      // inteiramente de crédito de pacote. Aí a casa bancou sozinha, e um
      // lançamento de valor zero só sujaria o extrato.
      if (rateio.parteDoBarbeiroCentavos > 0) {
        await this.lancamentos.salvar(
          LancamentoComissao.criarDeDescontoConcedido({
            id: randomUUID(),
            companyId: evento.companyId,
            barbeiroId: evento.barbeiroId,
            atendimentoId: evento.atendimentoId,
            descontoTotal: Dinheiro.deCentavos(evento.descontoConcedidoCentavos),
            parteDoBarbeiro: Dinheiro.deCentavos(rateio.parteDoBarbeiroCentavos),
            ocorridoEm: evento.ocorridoEm,
          }),
        );
      }
    }
  }
}
