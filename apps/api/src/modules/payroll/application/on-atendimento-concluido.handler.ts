import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import {
  LANCAMENTO_COMISSAO_REPOSITORY,
  LancamentoComissaoRepository,
} from '../domain/lancamento-comissao.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { AtendimentoConcluido } from '../../scheduling/domain/atendimento.events';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { repartirEntreBarbeiroECasa } from '../domain/rateio-do-acerto';
import {
  absorcaoDaTaxaPeloBarbeiro,
  type BaseComissionavel,
} from '../domain/taxa-do-pagamento-online';
import { Percentual } from '../../../shared/domain/percentual';
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
      await this.lancamentos.salvar(lancamento);
    }

    await this.lancarAjustesDoFechamento(evento, barbeiro);
    await this.lancarTaxaDoPagamentoOnline(evento, barbeiro, taxaDaEmpresa);
  }

  /**
   * FASE 8 (2026-08-27): comissão sobre o LÍQUIDO, como linha própria.
   *
   * A taxa que o gateway retém é rateada entre as bases comissionáveis desta
   * comanda, cada fatia leva o percentual do SEU item, e a soma é a parte que o
   * barbeiro absorve. Ver `taxa-do-pagamento-online.ts` para a identidade que
   * torna isso idêntico a reduzir cada base — e para por que a linha vence.
   *
   * ★ Precisa dos MESMOS percentuais usados nos lançamentos acima, e por isso é
   * chamada aqui, com o mesmo `barbeiro` e a mesma `taxaDaEmpresa` já lidos: se
   * relesse o cadastro, uma edição concorrente do percentual faria a absorção não
   * casar com a comissão que ela desconta.
   */
  private async lancarTaxaDoPagamentoOnline(
    evento: AtendimentoConcluido,
    barbeiro: Barbeiro,
    taxaDaEmpresa: Percentual | null,
  ): Promise<void> {
    if (evento.taxaPagamentoOnlineCentavos <= 0) return;

    // Caixinha e desconto ficam FORA: são declarados no fechamento, e o pagamento
    // online aconteceu no agendamento — não passaram pelo gateway.
    const bases: BaseComissionavel[] = [
      ...evento.itens.map((i) => ({
        baseCentavos: i.valorCobradoCentavos,
        percentualBp: barbeiro.percentualPara(i.servicoId).pontosBase,
      })),
      ...evento.produtos.map((p) => ({
        baseCentavos: p.valorUnitarioCentavos * p.quantidade,
        // `taxaDaEmpresa` é não-nulo sempre que há produto (lido acima por essa
        // razão); o `?? 0` é só para o compilador, não um fallback silencioso.
        percentualBp: taxaDaEmpresa?.pontosBase ?? 0,
      })),
    ];

    const absorcao = absorcaoDaTaxaPeloBarbeiro(evento.taxaPagamentoOnlineCentavos, bases);
    // Zero = a casa bancou a taxa inteira (barbeiro a 0%, ou a parte dele não
    // chega a um centavo). Um lançamento de zero só sujaria o extrato.
    if (absorcao.doBarbeiroCentavos <= 0) return;

    await this.lancamentos.salvar(
      LancamentoComissao.criarDeTaxaDePagamentoOnline({
        id: randomUUID(),
        companyId: evento.companyId,
        barbeiroId: evento.barbeiroId,
        atendimentoId: evento.atendimentoId,
        taxaTotal: Dinheiro.deCentavos(absorcao.taxaTotalCentavos),
        parteDoBarbeiro: Dinheiro.deCentavos(absorcao.doBarbeiroCentavos),
        ocorridoEm: evento.ocorridoEm,
      }),
    );
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
    barbeiro: Barbeiro,
  ): Promise<void> {
    // ★ Os dois percentuais são lidos do barbeiro AGORA, na conclusão, e
    // congelados no lançamento (§3.5). Mudar o cadastro depois não mexe em
    // nada já lançado — o extrato guarda o acordo do dia do atendimento.
    if (evento.caixinhaCentavos > 0) {
      const caixinha = repartirEntreBarbeiroECasa(
        evento.caixinhaCentavos,
        barbeiro.percentualCaixinha.pontosBase,
      );
      // Zero quando o barbeiro está a 0% de caixinha: a casa ficou com tudo, e
      // um lançamento de valor zero só sujaria o extrato dele.
      if (caixinha.doBarbeiroCentavos > 0) {
        await this.lancamentos.salvar(
          LancamentoComissao.criarDeCaixinha({
            id: randomUUID(),
            companyId: evento.companyId,
            barbeiroId: evento.barbeiroId,
            atendimentoId: evento.atendimentoId,
            valorTotal: Dinheiro.deCentavos(evento.caixinhaCentavos),
            percentualDoBarbeiro: barbeiro.percentualCaixinha,
            parteDoBarbeiro: Dinheiro.deCentavos(caixinha.doBarbeiroCentavos),
            ocorridoEm: evento.ocorridoEm,
          }),
        );
      }
    }

    if (evento.descontoConcedidoCentavos > 0) {
      const desconto = repartirEntreBarbeiroECasa(
        evento.descontoConcedidoCentavos,
        barbeiro.percentualDescontoAbsorvido.pontosBase,
      );
      // Zero quando o barbeiro não absorve nada: a casa bancou sozinha.
      if (desconto.doBarbeiroCentavos > 0) {
        await this.lancamentos.salvar(
          LancamentoComissao.criarDeDescontoConcedido({
            id: randomUUID(),
            companyId: evento.companyId,
            barbeiroId: evento.barbeiroId,
            atendimentoId: evento.atendimentoId,
            descontoTotal: Dinheiro.deCentavos(evento.descontoConcedidoCentavos),
            percentualAbsorvido: barbeiro.percentualDescontoAbsorvido,
            parteDoBarbeiro: Dinheiro.deCentavos(desconto.doBarbeiroCentavos),
            ocorridoEm: evento.ocorridoEm,
          }),
        );
      }
    }
  }
}
