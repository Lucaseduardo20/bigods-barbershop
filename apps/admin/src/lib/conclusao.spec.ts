import { describe, expect, it } from 'vitest';
import { valorACobrarNaConclusao, valorNaoCobertoPorCredito } from './conclusao';

function item(valorCobradoCentavos: number, itemDoPacoteId: string | null) {
  return { servicoId: 'svc', servicoNome: 'Corte', valorCobradoCentavos, duracaoMinutos: 30, itemDoPacoteId };
}
function produto(valorUnitarioCentavos: number, quantidade = 1) {
  return { produtoId: 'prod', produtoNome: 'Gel', quantidade, valorUnitarioCentavos };
}

describe('valorNaoCobertoPorCredito', () => {
  it('BUG FINANCEIRO (sessão-C): add-on num atendimento de crédito cobra SÓ o item adicionado, não o já pago pelo pacote', () => {
    // atendimento de crédito: item original rateado (R$34,29) já pago pelo pacote + barba avulsa adicionada na cadeira (R$30)
    const a = { itens: [item(3429, 'item-pacote-1'), item(3000, null)], produtos: [] };
    expect(valorNaoCobertoPorCredito(a)).toBe(3000); // só a barba — nunca 3429+3000
  });

  it('atendimento 100% de crédito, sem add-on: nada a cobrar', () => {
    const a = { itens: [item(3429, 'item-pacote-1')], produtos: [] };
    expect(valorNaoCobertoPorCredito(a)).toBe(0);
  });

  it('atendimento avulso puro (sem pacote): cobra o total normalmente', () => {
    const a = { itens: [item(4000, null), item(3000, null)], produtos: [] };
    expect(valorNaoCobertoPorCredito(a)).toBe(7000);
  });

  it('produto vendido junto de um atendimento de crédito também entra na conta (nunca é crédito de pacote)', () => {
    const a = { itens: [item(3429, 'item-pacote-1')], produtos: [produto(1500, 2)] };
    expect(valorNaoCobertoPorCredito(a)).toBe(3000);
  });
});

describe('valorACobrarNaConclusao', () => {
  it('desconta o que já foi pago online do valor não coberto por crédito', () => {
    const a = { itens: [item(4000, null)], produtos: [], valorPagoOnlineCentavos: 4000 };
    expect(valorACobrarNaConclusao(a)).toBe(0);
  });

  it('add-on em atendimento pago online: cobra só o adicional, não o valor já pago', () => {
    // pagou online o corte (4000); adicionou barba avulsa (3000) na cadeira
    const a = { itens: [item(4000, null), item(3000, null)], produtos: [], valorPagoOnlineCentavos: 4000 };
    expect(valorACobrarNaConclusao(a)).toBe(3000);
  });

  it('nunca fica negativo mesmo se o pago online exceder o não-coberto (ex.: só item de pacote + pago online por engano)', () => {
    const a = { itens: [item(3429, 'item-pacote-1')], produtos: [], valorPagoOnlineCentavos: 100 };
    expect(valorACobrarNaConclusao(a)).toBe(0);
  });
});
