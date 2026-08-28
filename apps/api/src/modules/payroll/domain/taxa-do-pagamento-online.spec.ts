import { describe, expect, it } from 'vitest';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import {
  absorcaoDaTaxaPeloBarbeiro,
  ratearTaxaEntreBases,
  taxaRetidaCentavos,
  type BaseComissionavel,
} from './taxa-do-pagamento-online';

describe('taxaRetidaCentavos — de onde vem a taxa', () => {
  it('do líquido informado pelo gateway, quando existe', () => {
    // 40,00 bruto, 38,40 líquido → 1,60 de taxa. É o `paid_amount` do Mercado Pago.
    expect(taxaRetidaCentavos(4000, 3840, null)).toBe(160);
  });

  it('★ o líquido informado VENCE a taxa configurada', () => {
    // O número real da transação inclui variações que nenhuma config acompanharia
    // (promoção de tarifa, antecipação, bandeira). A config é rede, não fonte.
    expect(taxaRetidaCentavos(4000, 3840, 999)).toBe(160);
  });

  it('da taxa configurada quando não há líquido — o caso da AbacatePay', () => {
    // 2,99% de 40,00 = 1,196 → 1,20 arredondado.
    expect(taxaRetidaCentavos(4000, null, 299)).toBe(120);
  });

  it('★ devolve null quando não há NENHUMA das duas fontes', () => {
    // Distinto de zero: é "não sabemos", e quem chama tem que gritar em vez de
    // tratar como "sem taxa".
    expect(taxaRetidaCentavos(4000, null, null)).toBeNull();
  });

  it('taxa configurada ZERO é zero, não desconhecida', () => {
    expect(taxaRetidaCentavos(4000, null, 0)).toBe(0);
  });

  it('líquido igual ao bruto é taxa zero', () => {
    expect(taxaRetidaCentavos(4000, 4000, null)).toBe(0);
  });

  it('★ líquido MAIOR que o bruto é recusado, não normalizado', () => {
    // Significa argumentos trocados, ou que o campo lido do gateway não é o
    // líquido. Silenciar produziria comissão sobre um bruto inflado.
    expect(() => taxaRetidaCentavos(3840, 4000, null)).toThrow(InvarianteVioladaError);
  });

  it('recusa valores não inteiros ou negativos', () => {
    expect(() => taxaRetidaCentavos(40.5, null, 299)).toThrow(InvarianteVioladaError);
    expect(() => taxaRetidaCentavos(-1, null, 299)).toThrow(InvarianteVioladaError);
    expect(() => taxaRetidaCentavos(4000, -1, null)).toThrow(InvarianteVioladaError);
  });

  it('recusa taxa fora de 0..10000 pontos-base', () => {
    expect(() => taxaRetidaCentavos(4000, null, 10001)).toThrow(InvarianteVioladaError);
    expect(() => taxaRetidaCentavos(4000, null, 2.99)).toThrow(InvarianteVioladaError);
  });

  it('bruto zero dá taxa zero em qualquer fonte', () => {
    expect(taxaRetidaCentavos(0, 0, null)).toBe(0);
    expect(taxaRetidaCentavos(0, null, 299)).toBe(0);
  });
});

describe('★ ratearTaxaEntreBases — Σ fatias == taxa, SEMPRE', () => {
  const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('reparte proporcionalmente em caso exato', () => {
    expect(ratearTaxaEntreBases(100, [3000, 1000])).toEqual([75, 25]);
  });

  it('★ 3 itens com valores primos — o caso hostil do CLAUDE.md', () => {
    // Nenhuma fração fecha; o resto tem que ir para alguém e a soma tem que bater.
    const fatias = ratearTaxaEntreBases(101, [1301, 2903, 4409]);
    expect(soma(fatias)).toBe(101);
  });

  it('★ fuzz determinístico: a soma bate para centenas de combinações', () => {
    // Sem `Math.random` — a sequência é gerada, não sorteada, para que uma falha
    // seja reproduzível. Um centavo perdido aqui vira divergência no acerto do
    // barbeiro, que é onde ninguém quer explicar aritmética.
    for (let taxa = 0; taxa <= 40; taxa += 7) {
      for (let a = 1; a < 900; a += 137) {
        for (let b = 1; b < 900; b += 211) {
          for (let c = 1; c < 900; c += 313) {
            const fatias = ratearTaxaEntreBases(taxa, [a, b, c]);
            expect(soma(fatias), `${taxa} / ${a},${b},${c}`).toBe(taxa);
            for (const f of fatias) expect(f).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it('★ nenhuma fatia excede a própria base — taxa nunca "come" mais que o item', () => {
    // É o que garante que a absorção do barbeiro nunca passe da comissão dele.
    const bases = [500, 1500, 3000];
    const fatias = ratearTaxaEntreBases(4999, bases);
    fatias.forEach((f, i) => expect(f).toBeLessThanOrEqual(bases[i]!));
  });

  it('bases todas zero devolve fatias zero, sem dividir por zero', () => {
    expect(ratearTaxaEntreBases(100, [0, 0])).toEqual([0, 0]);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(ratearTaxaEntreBases(100, [])).toEqual([]);
  });

  it('taxa zero devolve tudo zero', () => {
    expect(ratearTaxaEntreBases(0, [1000, 2000])).toEqual([0, 0]);
  });

  it('★ é DETERMINÍSTICO — dois recálculos do mesmo acerto não podem discordar', () => {
    const bases = [333, 333, 334];
    const primeiro = ratearTaxaEntreBases(10, bases);
    for (let i = 0; i < 5; i++) {
      expect(ratearTaxaEntreBases(10, bases)).toEqual(primeiro);
    }
  });

  it('empate de fração é resolvido pelo ÍNDICE, não por ordem instável', () => {
    // Três bases idênticas e 1 centavo de resto: vai para a primeira, sempre.
    expect(ratearTaxaEntreBases(1, [100, 100, 100])).toEqual([1, 0, 0]);
  });

  it('resto maior que o número de itens ainda distribui tudo', () => {
    const fatias = ratearTaxaEntreBases(7, [1, 1]);
    expect(soma(fatias)).toBe(7);
  });

  it('recusa taxa ou base inválida', () => {
    expect(() => ratearTaxaEntreBases(-1, [100])).toThrow(InvarianteVioladaError);
    expect(() => ratearTaxaEntreBases(10, [-100])).toThrow(InvarianteVioladaError);
    expect(() => ratearTaxaEntreBases(10, [10.5])).toThrow(InvarianteVioladaError);
  });
});

describe('absorcaoDaTaxaPeloBarbeiro', () => {
  it('percentual único: absorve a fração da comissão', () => {
    // Taxa 160, um item, barbeiro a 45% → 72 dele, 88 da casa.
    const r = absorcaoDaTaxaPeloBarbeiro(160, [{ baseCentavos: 4000, percentualBp: 4500 }]);
    expect(r).toEqual({ taxaTotalCentavos: 160, doBarbeiroCentavos: 72, daCasaCentavos: 88 });
  });

  it('★ percentuais DIFERENTES por item — a razão de ratear antes de aplicar', () => {
    // Corte a 50%, barba a 30%. Não existe "um percentual" para aplicar sobre a
    // taxa toda: cada fatia leva o percentual do seu serviço.
    const itens: BaseComissionavel[] = [
      { baseCentavos: 6000, percentualBp: 5000 },
      { baseCentavos: 4000, percentualBp: 3000 },
    ];
    const r = absorcaoDaTaxaPeloBarbeiro(300, itens);
    // fatias: 180 e 120 → 90 + 36 = 126
    expect(r.doBarbeiroCentavos).toBe(126);
    expect(r.daCasaCentavos).toBe(174);
  });

  it('★ doBarbeiro + daCasa == taxaTotal, sempre — a casa fica com o resto', () => {
    for (const taxa of [0, 1, 7, 13, 160, 999, 12345]) {
      for (const bp of [0, 1, 3000, 4500, 5000, 7777, 10000]) {
        const r = absorcaoDaTaxaPeloBarbeiro(taxa, [
          { baseCentavos: 1301, percentualBp: bp },
          { baseCentavos: 2903, percentualBp: bp },
        ]);
        expect(r.doBarbeiroCentavos + r.daCasaCentavos, `${taxa}/${bp}`).toBe(taxa);
      }
    }
  });

  it('★ barbeiro a 100% absorve a taxa INTEIRA (ou quase — arredondamento por fatia)', () => {
    const r = absorcaoDaTaxaPeloBarbeiro(160, [{ baseCentavos: 4000, percentualBp: 10000 }]);
    expect(r.doBarbeiroCentavos).toBe(160);
    expect(r.daCasaCentavos).toBe(0);
  });

  it('barbeiro a 0% não absorve nada — a casa banca a taxa inteira', () => {
    const r = absorcaoDaTaxaPeloBarbeiro(160, [{ baseCentavos: 4000, percentualBp: 0 }]);
    expect(r.doBarbeiroCentavos).toBe(0);
    expect(r.daCasaCentavos).toBe(160);
  });

  it('★ a absorção nunca passa da taxa', () => {
    // Se passasse, a linha do extrato seria recusada pelo agregado — e o barbeiro
    // pagaria mais taxa do que o gateway cobrou.
    for (const taxa of [1, 2, 3, 99, 12345]) {
      const r = absorcaoDaTaxaPeloBarbeiro(taxa, [
        { baseCentavos: 1, percentualBp: 10000 },
        { baseCentavos: 99999, percentualBp: 10000 },
      ]);
      expect(r.doBarbeiroCentavos, `${taxa}`).toBeLessThanOrEqual(taxa);
    }
  });

  it('★★ IDENTIDADE: base bruta − absorção == Σ (base − fatia) × percentual', () => {
    /*
     * É o teorema que justifica implementar "comissão sobre o líquido" como LINHA
     * em vez de base reduzida. Se esta igualdade quebrar, as duas implementações
     * divergem e a escolha de transparência passa a custar dinheiro ao barbeiro.
     *
     * Vale por item, com arredondamento por fatia nos dois lados — é por isso que
     * a absorção é `Σ round(fatiaᵢ × pᵢ)`, e não `round(Σ fatiaᵢ × pᵢ)`.
     */
    const casos: BaseComissionavel[][] = [
      [{ baseCentavos: 4000, percentualBp: 4500 }],
      [
        { baseCentavos: 6000, percentualBp: 5000 },
        { baseCentavos: 4000, percentualBp: 3000 },
      ],
      [
        { baseCentavos: 1301, percentualBp: 4237 },
        { baseCentavos: 2903, percentualBp: 6151 },
        { baseCentavos: 4409, percentualBp: 999 },
      ],
    ];
    for (const itens of casos) {
      for (const taxa of [0, 1, 13, 160, 777]) {
        const fatias = ratearTaxaEntreBases(
          taxa,
          itens.map((i) => i.baseCentavos),
        );
        const comissaoBruta = itens.reduce(
          (a, i) => a + Math.round((i.baseCentavos * i.percentualBp) / 10000),
          0,
        );
        const comissaoLiquidaDireta = itens.reduce(
          (a, i, k) => a + Math.round(((i.baseCentavos - fatias[k]!) * i.percentualBp) / 10000),
          0,
        );
        const absorcao = absorcaoDaTaxaPeloBarbeiro(taxa, itens);

        // A diferença entre as duas contas é de no máximo 1 centavo POR ITEM, e
        // vem só do arredondamento (round(a) − round(b) vs round(a − b)). O que o
        // teste fixa é que ela não pode crescer com o valor.
        const diferenca = Math.abs(
          comissaoBruta - absorcao.doBarbeiroCentavos - comissaoLiquidaDireta,
        );
        expect(diferenca, `taxa ${taxa} / ${itens.length} itens`).toBeLessThanOrEqual(itens.length);
      }
    }
  });

  it('sem itens não há o que absorver', () => {
    const r = absorcaoDaTaxaPeloBarbeiro(160, []);
    expect(r.doBarbeiroCentavos).toBe(0);
    expect(r.daCasaCentavos).toBe(160);
  });

  it('recusa percentual fora de 0..10000', () => {
    expect(() =>
      absorcaoDaTaxaPeloBarbeiro(160, [{ baseCentavos: 4000, percentualBp: 10001 }]),
    ).toThrow(InvarianteVioladaError);
  });
});
