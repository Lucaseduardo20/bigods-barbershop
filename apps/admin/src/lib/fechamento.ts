import type { AtendimentoDTO } from '@bigods/contracts';
import { valorACobrarNaConclusao, valorNaoCobertoPorCredito } from './conclusao';

export interface AjustesDoFechamento {
  caixinhaCentavos: number;
  descontoCentavos: number;
}

export interface ResumoDoFechamento {
  /** Tudo que foi feito, some quem pagou: serviços + produtos. */
  totalDaComandaCentavos: number;
  /** Parte já quitada por crédito de pacote, pagamento online ou saldo residual. */
  jaCobertoCentavos: number;
  /** O que o cliente deve AGORA, antes dos ajustes do fechamento. */
  aCobrarCentavos: number;
  /**
   * O que entra na mão de fato: o valor a cobrar, menos o desconto concedido,
   * mais a caixinha. É o número que o barbeiro confere contra o dinheiro no
   * balcão — por isso a caixinha entra aqui, ainda que ela não seja receita da
   * casa (no ledger ela vai 100% para o barbeiro, nunca para o caixa).
   */
  aReceberCentavos: number;
  /**
   * Teto do desconto na TELA: o que o cliente ainda deve. Descontar mais do que
   * ele deve não é desconto, é a casa pagando para atender.
   *
   * O domínio aceita até o total da comanda (que inclui o que já foi pago por
   * crédito de pacote) — o limite daqui é mais apertado de propósito, porque é o
   * único que faz sentido operacional na hora de fechar.
   */
  descontoMaximoCentavos: number;
}

/**
 * As contas da ETAPA 2 (pagamento) do fechamento da comanda.
 *
 * Função pura, fora do componente, porque é aritmética de dinheiro que alguém
 * vai conferir contra o caixa — merece teste próprio e não merece ser lida no
 * meio de JSX.
 */
export function resumoDoFechamento(
  a: Pick<
    AtendimentoDTO,
    'itens' | 'produtos' | 'valorTotalCentavos' | 'valorPagoOnlineCentavos' | 'valorAbatidoSaldoCentavos'
  >,
  ajustes: AjustesDoFechamento,
): ResumoDoFechamento {
  const aCobrarCentavos = valorACobrarNaConclusao(a);
  const desconto = Math.min(Math.max(0, ajustes.descontoCentavos), aCobrarCentavos);
  const caixinha = Math.max(0, ajustes.caixinhaCentavos);

  return {
    totalDaComandaCentavos: a.valorTotalCentavos,
    // O que o pacote cobriu é a diferença entre o total e o que não é coberto
    // por crédito; somado ao que já entrou por outro caminho.
    jaCobertoCentavos:
      a.valorTotalCentavos -
      valorNaoCobertoPorCredito(a) +
      a.valorPagoOnlineCentavos +
      a.valorAbatidoSaldoCentavos,
    aCobrarCentavos,
    aReceberCentavos: aCobrarCentavos - desconto + caixinha,
    descontoMaximoCentavos: aCobrarCentavos,
  };
}
