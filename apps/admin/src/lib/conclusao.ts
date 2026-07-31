import type { AtendimentoDTO } from '@bigods/contracts';

/**
 * Quanto falta cobrar na conclusão de um atendimento — bug financeiro
 * (sessão-C): itens com `itemDoPacoteId` preenchido já foram pagos pelo
 * crédito do pacote; um add-on (walk-in) nunca pode recobrar esses itens,
 * só a parte nova (item avulso adicionado ou produto). Mesmo critério de
 * `Atendimento.concluir()` no domínio (`exigeFormaPagamento`).
 */
export function valorNaoCobertoPorCredito(a: Pick<AtendimentoDTO, 'itens' | 'produtos'>): number {
  const itens = a.itens
    .filter((i) => i.itemDoPacoteId === null)
    .reduce((acc, i) => acc + i.valorCobradoCentavos, 0);
  const produtos = a.produtos.reduce((acc, p) => acc + p.valorUnitarioCentavos * p.quantidade, 0);
  return itens + produtos;
}

/** Valor efetivamente a cobrar agora — desconta o que já foi pago online. */
export function valorACobrarNaConclusao(a: Pick<AtendimentoDTO, 'itens' | 'produtos' | 'valorPagoOnlineCentavos'>): number {
  return Math.max(0, valorNaoCobertoPorCredito(a) - a.valorPagoOnlineCentavos);
}
