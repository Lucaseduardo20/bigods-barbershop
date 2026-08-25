import { describe, expect, it } from 'vitest';
import { resumoDoFechamento } from './fechamento';

/**
 * ★ As contas da etapa de PAGAMENTO. O barbeiro confere estes números contra o
 * dinheiro no balcão, então eles não podem viver soltos dentro de JSX.
 */

const comanda = (over: Partial<Parameters<typeof resumoDoFechamento>[0]> = {}) => ({
  itens: [
    {
      servicoId: 's1',
      servicoNome: 'Corte',
      valorCobradoCentavos: 4000,
      duracaoMinutos: 30,
      itemDoPacoteId: null,
      precoCheioCentavos: 4000,
    },
  ],
  produtos: [],
  valorTotalCentavos: 4000,
  valorPagoOnlineCentavos: 0,
  valorAbatidoSaldoCentavos: 0,
  ...over,
});

const semAjustes = { caixinhaCentavos: 0, descontoCentavos: 0 };

describe('resumo do fechamento', () => {
  it('comanda simples: o que se cobra é o total', () => {
    const r = resumoDoFechamento(comanda(), semAjustes);
    expect(r.aCobrarCentavos).toBe(4000);
    expect(r.aReceberCentavos).toBe(4000);
    expect(r.jaCobertoCentavos).toBe(0);
  });

  it('caixinha soma no que entra na mão', () => {
    const r = resumoDoFechamento(comanda(), { caixinhaCentavos: 700, descontoCentavos: 0 });
    expect(r.aReceberCentavos).toBe(4700);
    // Mas não muda o que a comanda vale.
    expect(r.totalDaComandaCentavos).toBe(4000);
  });

  it('desconto abate no que entra na mão', () => {
    const r = resumoDoFechamento(comanda(), { caixinhaCentavos: 0, descontoCentavos: 1000 });
    expect(r.aReceberCentavos).toBe(3000);
  });

  it('★ desconto não passa do que o cliente ainda deve', () => {
    const r = resumoDoFechamento(comanda(), { caixinhaCentavos: 0, descontoCentavos: 99999 });
    // Descontar mais do que ele deve não é desconto, é a casa pagando para
    // atender. O teto da tela é o valor a cobrar.
    expect(r.descontoMaximoCentavos).toBe(4000);
    expect(r.aReceberCentavos).toBe(0);
  });

  it('pago online: a cobrar é só a diferença', () => {
    const r = resumoDoFechamento(
      comanda({ valorPagoOnlineCentavos: 3000 }),
      { caixinhaCentavos: 500, descontoCentavos: 0 },
    );
    expect(r.aCobrarCentavos).toBe(1000);
    expect(r.jaCobertoCentavos).toBe(3000);
    expect(r.aReceberCentavos).toBe(1500);
  });

  it('★ crédito de pacote não é cobrado de novo', () => {
    const r = resumoDoFechamento(
      comanda({
        itens: [
          {
            servicoId: 's1',
            servicoNome: 'Corte',
            valorCobradoCentavos: 3500,
            duracaoMinutos: 30,
            itemDoPacoteId: 'item-1',
            precoCheioCentavos: null,
          },
        ],
        valorTotalCentavos: 3500,
      }),
      semAjustes,
    );
    expect(r.aCobrarCentavos).toBe(0);
    expect(r.jaCobertoCentavos).toBe(3500);
    // E o desconto fica travado em zero: não há o que descontar.
    expect(r.descontoMaximoCentavos).toBe(0);
  });

  it('crédito de pacote + produto adicionado: cobra só o produto', () => {
    const r = resumoDoFechamento(
      comanda({
        itens: [
          {
            servicoId: 's1',
            servicoNome: 'Corte',
            valorCobradoCentavos: 3500,
            duracaoMinutos: 30,
            itemDoPacoteId: 'item-1',
            precoCheioCentavos: null,
          },
        ],
        produtos: [
          { produtoId: 'p1', produtoNome: 'Pomada', quantidade: 2, valorUnitarioCentavos: 1500 },
        ],
        valorTotalCentavos: 6500,
      }),
      semAjustes,
    );
    expect(r.aCobrarCentavos).toBe(3000);
    expect(r.jaCobertoCentavos).toBe(3500);
  });

  it('valores negativos vindos da tela não viram crédito para o cliente', () => {
    const r = resumoDoFechamento(comanda(), { caixinhaCentavos: -500, descontoCentavos: -500 });
    expect(r.aReceberCentavos).toBe(4000);
  });
});
