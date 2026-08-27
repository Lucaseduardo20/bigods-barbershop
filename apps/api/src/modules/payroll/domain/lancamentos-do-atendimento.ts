import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';
import { AtendimentoId, CompanyId, ProdutoId, ServicoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { LancamentoComissao } from './lancamento-comissao.aggregate';
import { repartirEntreBarbeiroECasa } from './rateio-do-acerto';

/**
 * OS LANÇAMENTOS QUE UM ATENDIMENTO CONCLUÍDO GERA PARA UM BARBEIRO.
 *
 * Isto existe desde 2026-08-27 por uma razão concreta: a mesma conta passou a
 * ter DOIS chamadores.
 *
 * 1. `OnAtendimentoConcluidoHandler` — a conclusão normal;
 * 2. `CorrigirBarbeiroDoAtendimentoUseCase` — quando a comissão foi lançada
 *    para quem não atendeu, e precisa nascer de novo no nome de quem atendeu,
 *    pela TAXA DELE.
 *
 * Duas implementações da mesma conta divergiriam no primeiro ajuste, e o
 * sintoma seria dinheiro diferente dependendo do caminho — o pior tipo de bug
 * que este ledger pode ter. Função PURA: recebe tudo o que precisa e devolve os
 * lançamentos, sem tocar em repositório.
 */

export interface ItemParaComissao {
  servicoId: ServicoId;
  valorCobradoCentavos: number;
}

export interface ProdutoParaComissao {
  produtoId: ProdutoId;
  valorUnitarioCentavos: number;
  quantidade: number;
}

export interface EntradaDosLancamentos {
  companyId: CompanyId;
  atendimentoId: AtendimentoId;
  /** De quem é a comissão. TODOS os percentuais saem daqui — é o que muda numa correção. */
  barbeiro: Barbeiro;
  itens: ItemParaComissao[];
  produtos: ProdutoParaComissao[];
  /**
   * Taxa de produto da EMPRESA (§3.9.1) — obrigatória quando há produto, ignorada
   * quando não há. Vem de fora porque é consulta a outro agregado.
   */
  taxaDeProduto: Percentual | null;
  caixinhaCentavos: number;
  descontoConcedidoCentavos: number;
  ocorridoEm: Date;
  /** Injetado para o teste poder prever os ids; em produção é `randomUUID`. */
  novoId: () => string;
}

export function lancamentosDoAtendimentoConcluido(
  entrada: EntradaDosLancamentos,
): LancamentoComissao[] {
  const lancamentos: LancamentoComissao[] = [];

  for (const item of entrada.itens) {
    lancamentos.push(
      LancamentoComissao.criarDeServico({
        id: entrada.novoId(),
        companyId: entrada.companyId,
        barbeiroId: entrada.barbeiro.id,
        atendimentoId: entrada.atendimentoId,
        servicoId: item.servicoId,
        valorBase: Dinheiro.deCentavos(item.valorCobradoCentavos),
        // A matriz do barbeiro DESTE lançamento: exceção por serviço, senão o
        // padrão dele. É o número que muda quando a comissão troca de dono.
        percentualAplicado: entrada.barbeiro.percentualPara(item.servicoId),
        ocorridoEm: entrada.ocorridoEm,
      }),
    );
  }

  if (entrada.produtos.length > 0 && !entrada.taxaDeProduto) {
    throw new InvarianteVioladaError(
      'Atendimento com produto exige a taxa de comissão de produto da empresa',
    );
  }
  for (const produto of entrada.produtos) {
    lancamentos.push(
      LancamentoComissao.criarDeProduto({
        id: entrada.novoId(),
        companyId: entrada.companyId,
        barbeiroId: entrada.barbeiro.id,
        atendimentoId: entrada.atendimentoId,
        produtoId: produto.produtoId,
        valorBase: Dinheiro.deCentavos(produto.valorUnitarioCentavos).multiplicarPorInteiro(
          produto.quantidade,
        ),
        // Produto é revenda: a taxa é da EMPRESA, igual para todo barbeiro.
        // Numa correção de dono, portanto, ela NÃO muda — só a de serviço muda.
        percentualAplicado: entrada.taxaDeProduto!,
        ocorridoEm: entrada.ocorridoEm,
      }),
    );
  }

  if (entrada.caixinhaCentavos > 0) {
    const caixinha = repartirEntreBarbeiroECasa(
      entrada.caixinhaCentavos,
      entrada.barbeiro.percentualCaixinha.pontosBase,
    );
    // Zero quando o barbeiro está a 0% de caixinha: a casa ficou com tudo, e um
    // lançamento de valor zero só sujaria o extrato dele.
    if (caixinha.doBarbeiroCentavos > 0) {
      lancamentos.push(
        LancamentoComissao.criarDeCaixinha({
          id: entrada.novoId(),
          companyId: entrada.companyId,
          barbeiroId: entrada.barbeiro.id,
          atendimentoId: entrada.atendimentoId,
          valorTotal: Dinheiro.deCentavos(entrada.caixinhaCentavos),
          percentualDoBarbeiro: entrada.barbeiro.percentualCaixinha,
          parteDoBarbeiro: Dinheiro.deCentavos(caixinha.doBarbeiroCentavos),
          ocorridoEm: entrada.ocorridoEm,
        }),
      );
    }
  }

  if (entrada.descontoConcedidoCentavos > 0) {
    const desconto = repartirEntreBarbeiroECasa(
      entrada.descontoConcedidoCentavos,
      entrada.barbeiro.percentualDescontoAbsorvido.pontosBase,
    );
    if (desconto.doBarbeiroCentavos > 0) {
      lancamentos.push(
        LancamentoComissao.criarDeDescontoConcedido({
          id: entrada.novoId(),
          companyId: entrada.companyId,
          barbeiroId: entrada.barbeiro.id,
          atendimentoId: entrada.atendimentoId,
          descontoTotal: Dinheiro.deCentavos(entrada.descontoConcedidoCentavos),
          percentualAbsorvido: entrada.barbeiro.percentualDescontoAbsorvido,
          parteDoBarbeiro: Dinheiro.deCentavos(desconto.doBarbeiroCentavos),
          ocorridoEm: entrada.ocorridoEm,
        }),
      );
    }
  }

  return lancamentos;
}
