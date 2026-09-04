import { describe, expect, it } from 'vitest';
import { OrigemComissao, Papel, TipoLancamento } from '@bigods/contracts';
import { LancamentoComissao } from './lancamento-comissao.aggregate';
import { calcularSaldoCentavos, sinalDoTipo } from './saldo-do-barbeiro';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const ocorridoEm = new Date(Date.UTC(2026, 6, 15, 12));

const barbeiro = Barbeiro.criar({
  id: 'bar-1',
  companyId: 'co-1',
  nome: 'Gabriel',
  slug: 'gabriel',
  papeis: new Set([Papel.BARBEIRO]),
  comissaoPadrao: Percentual.dePorcentagem(45),
  excecoesComissao: new Map([['svc-barba', Percentual.dePorcentagem(60)]]),
  servicosAtendidos: new Set(['svc-corte', 'svc-barba']),
});

const criar = (servicoId: string, valorBaseCentavos: number) =>
  LancamentoComissao.criarDeServico({
    id: 'lc-1',
    companyId: 'co-1',
    barbeiroId: barbeiro.id,
    atendimentoId: 'at-1',
    servicoId,
    valorBase: Dinheiro.deCentavos(valorBaseCentavos),
    percentualAplicado: barbeiro.percentualPara(servicoId),
    ocorridoEm,
  });

describe('LancamentoComissao', () => {
  it('percentual padrão: 45% de R$40,00 = R$18,00', () => {
    const lc = criar('svc-corte', 4000);
    expect(lc.percentualAplicado.porcentagem).toBe(45);
    expect(lc.valorComissao.centavos).toBe(1800);
  });

  it('exceção por serviço vence o padrão: 60% na barba', () => {
    const lc = criar('svc-barba', 3000);
    expect(lc.percentualAplicado.porcentagem).toBe(60);
    expect(lc.valorComissao.centavos).toBe(1800);
  });

  it('origem pacote: valor base é o RATEADO, não o preço avulso', () => {
    // corte avulso R$40, mas rateado no pacote saiu R$34,29
    const lc = criar('svc-corte', 3429);
    expect(lc.valorBase.centavos).toBe(3429);
    expect(lc.valorComissao.centavos).toBe(1543); // 45% de 3429 = 1543.05 → 1543
  });

  it('snapshot do percentual: mudança futura na regra não afeta lançamento existente', () => {
    const lc = criar('svc-corte', 4000);
    barbeiro.definirExcecaoComissao('svc-corte', Percentual.dePorcentagem(70));
    expect(lc.percentualAplicado.porcentagem).toBe(45);
    expect(lc.valorComissao.centavos).toBe(1800);
  });

  it('origem SERVICO: servicoId preenchido, produtoId/vendaDeProdutoId null', () => {
    const lc = criar('svc-corte', 4000);
    expect(lc.origem).toBe('SERVICO');
    expect(lc.servicoId).toBe('svc-corte');
    expect(lc.produtoId).toBeNull();
    expect(lc.vendaDeProdutoId).toBeNull();
    expect(lc.atendimentoId).toBe('at-1');
  });
});

describe('LancamentoComissao — origem PRODUTO (item 4, sessão 2026-07-16)', () => {
  it('usa comissaoProdutos do barbeiro (percentual único, sem matriz)', () => {
    const b = Barbeiro.criar({
      id: 'bar-2',
      companyId: 'co-1',
      nome: 'Pedro',
      slug: 'pedro',
      papeis: new Set([Papel.BARBEIRO]),
      comissaoPadrao: Percentual.dePorcentagem(45),
      comissaoProdutos: Percentual.dePorcentagem(10),
      servicosAtendidos: new Set(),
    });
    const lc = LancamentoComissao.criarDeProduto({
      id: 'lc-2',
      companyId: 'co-1',
      barbeiroId: b.id,
      atendimentoId: 'at-1',
      produtoId: 'prod-gel',
      valorBase: Dinheiro.deCentavos(3000), // 2 × R$15,00
      percentualAplicado: b.comissaoProdutos,
      ocorridoEm,
    });
    expect(lc.origem).toBe('PRODUTO');
    expect(lc.produtoId).toBe('prod-gel');
    expect(lc.servicoId).toBeNull();
    expect(lc.valorComissao.centavos).toBe(300); // 10% de 3000
  });

  it('venda avulsa: vendaDeProdutoId preenchido, atendimentoId null', () => {
    const lc = LancamentoComissao.criarDeProduto({
      id: 'lc-3',
      companyId: 'co-1',
      barbeiroId: 'bar-1',
      vendaDeProdutoId: 'venda-1',
      produtoId: 'prod-gel',
      valorBase: Dinheiro.deCentavos(1500),
      percentualAplicado: Percentual.dePorcentagem(10),
      ocorridoEm,
    });
    expect(lc.vendaDeProdutoId).toBe('venda-1');
    expect(lc.atendimentoId).toBeNull();
  });

  it('exige exatamente um de atendimentoId/vendaDeProdutoId — nenhum dos dois falha', () => {
    expect(() =>
      LancamentoComissao.criarDeProduto({
        id: 'lc-4',
        companyId: 'co-1',
        barbeiroId: 'bar-1',
        produtoId: 'prod-gel',
        valorBase: Dinheiro.deCentavos(1500),
        percentualAplicado: Percentual.dePorcentagem(10),
        ocorridoEm,
      }),
    ).toThrow();
  });

  it('exige exatamente um de atendimentoId/vendaDeProdutoId — os dois juntos falha', () => {
    expect(() =>
      LancamentoComissao.criarDeProduto({
        id: 'lc-5',
        companyId: 'co-1',
        barbeiroId: 'bar-1',
        atendimentoId: 'at-1',
        vendaDeProdutoId: 'venda-1',
        produtoId: 'prod-gel',
        valorBase: Dinheiro.deCentavos(1500),
        percentualAplicado: Percentual.dePorcentagem(10),
        ocorridoEm,
      }),
    ).toThrow();
  });
});

describe('LancamentoComissao — ledger de 3 direções (sessão de vale/pagamento)', () => {
  it('criarDeServico/criarDeProduto continuam gerando tipo=COMISSAO por padrão (compatibilidade)', () => {
    const lc = criar('svc-corte', 4000);
    expect(lc.tipo).toBe('COMISSAO');
    expect(lc.valeId).toBeNull();
    expect(lc.registradoPorId).toBeNull();
  });

  it('criarDeVale: tipo=VALE, sem origem/valorBase/percentualAplicado, valor = magnitude do vale', () => {
    const lc = LancamentoComissao.criarDeVale({
      id: 'lc-vale-1',
      companyId: 'co-1',
      barbeiroId: 'bar-1',
      valeId: 'vale-1',
      registradoPorId: 'bar-admin',
      valor: Dinheiro.deCentavos(20000),
      ocorridoEm,
    });
    expect(lc.tipo).toBe('VALE');
    expect(lc.origem).toBeNull();
    expect(lc.valorBase).toBeNull();
    expect(lc.percentualAplicado).toBeNull();
    expect(lc.valeId).toBe('vale-1');
    expect(lc.registradoPorId).toBe('bar-admin');
    expect(lc.valorComissao.centavos).toBe(20000);
  });

  it('criarDeVale rejeita valor zero', () => {
    expect(() =>
      LancamentoComissao.criarDeVale({
        id: 'lc-vale-2',
        companyId: 'co-1',
        barbeiroId: 'bar-1',
        valeId: 'vale-1',
        registradoPorId: 'bar-admin',
        valor: Dinheiro.zero(),
        ocorridoEm,
      }),
    ).toThrow(InvarianteVioladaError);
  });

  it('criarDePagamento: tipo=PAGAMENTO, sem valeId, valor = magnitude do pagamento', () => {
    const lc = LancamentoComissao.criarDePagamento({
      id: 'lc-pag-1',
      companyId: 'co-1',
      barbeiroId: 'bar-1',
      registradoPorId: 'bar-admin',
      valor: Dinheiro.deCentavos(50000),
      ocorridoEm,
    });
    expect(lc.tipo).toBe('PAGAMENTO');
    expect(lc.valeId).toBeNull();
    expect(lc.origem).toBeNull();
    expect(lc.registradoPorId).toBe('bar-admin');
    expect(lc.valorComissao.centavos).toBe(50000);
  });

  it('criarDePagamento rejeita valor zero', () => {
    expect(() =>
      LancamentoComissao.criarDePagamento({
        id: 'lc-pag-2',
        companyId: 'co-1',
        barbeiroId: 'bar-1',
        registradoPorId: 'bar-admin',
        valor: Dinheiro.zero(),
        ocorridoEm,
      }),
    ).toThrow(InvarianteVioladaError);
  });
});

describe('★ REGRESSÃO — lançamentos de comissão pré-migration continuam idênticos', () => {
  it('reconstituir um lançamento no formato ANTIGO (tipo=COMISSAO retroativo, sem vale/pagamento) preserva valor e sinal', () => {
    // Simula exatamente o que a migration fez a TODA linha existente: tipo
    // ganhou o default 'COMISSAO', valeId/registradoPorId ficaram null — o
    // resto do formato (origem, valorBase, percentualAplicado, valorComissao)
    // é byte a byte o que já estava gravado antes desta sessão.
    const legado = LancamentoComissao.reconstituir({
      id: 'lc-legado',
      companyId: 'co-1',
      barbeiroId: 'bar-1',
      tipo: TipoLancamento.COMISSAO,
      origem: OrigemComissao.SERVICO,
      atendimentoId: 'at-1',
      vendaDeProdutoId: null,
      servicoId: 'svc-corte',
      produtoId: null,
      valeId: null,
      registradoPorId: null,
      valorBase: Dinheiro.deCentavos(4000),
      percentualAplicado: Percentual.dePorcentagem(45),
      valorComissao: Dinheiro.deCentavos(1800),
      ocorridoEm,
    });
    expect(legado.valorComissao.centavos).toBe(1800);
    expect(legado.valorBase!.centavos).toBe(4000);
    expect(legado.percentualAplicado!.porcentagem).toBe(45);
    expect(legado.tipo).toBe('COMISSAO');
    expect(legado.origem).toBe('SERVICO');
  });

  it('saldo de um barbeiro só com lançamentos de COMISSAO é EXATAMENTE a soma simples — mesmo resultado de antes desta sessão', () => {
    const lancamentos = [criar('svc-corte', 4000), criar('svc-barba', 3000)];
    const somaSimples = lancamentos.reduce((acc, l) => acc + l.valorComissao.centavos, 0);
    expect(calcularSaldoCentavos(lancamentos)).toBe(somaSimples);
  });
});

describe('★ taxa do pagamento online (Fase 8) — comissão sobre o líquido como linha', () => {
  const base = {
    id: 'lanc-taxa-1',
    companyId: 'co-1',
    barbeiroId: 'barb-1',
    atendimentoId: 'at-1',
    ocorridoEm: new Date('2026-08-27T15:00:00.000Z'),
  };

  it('nasce como débito, com a taxa inteira na base e a parte dele no valor', () => {
    const l = LancamentoComissao.criarDeTaxaDePagamentoOnline({
      ...base,
      taxaTotal: Dinheiro.deCentavos(160),
      parteDoBarbeiro: Dinheiro.deCentavos(72),
    });
    expect(l.tipo).toBe(TipoLancamento.TAXA_PAGAMENTO_ONLINE);
    expect(l.valorBase!.centavos).toBe(160);
    expect(l.valorComissao.centavos).toBe(72);
    // Os dois juntos deixam a linha auditável: "taxa de R$1,60 · sua parte R$0,72".
    expect(l.origem).toBeNull();
  });

  it('★ SUBTRAI no saldo — nunca soma', () => {
    // Se `sinalDoTipo` tratasse este tipo como crédito, a taxa que o gateway
    // cobrou apareceria como ganho do barbeiro. O sinal vem de `tipo`, e tudo que
    // não é COMISSAO é -1 — este teste é o cadeado disso.
    expect(sinalDoTipo(TipoLancamento.TAXA_PAGAMENTO_ONLINE)).toBe(-1);
  });

  it('★ percentualAplicado é NULL — não existe UM percentual honesto aqui', () => {
    // A taxa é rateada entre os itens da comanda e cada fatia leva o percentual do
    // SEU serviço. Gravar a razão parte/total seria um número derivado convidando
    // alguém a recalcular e chegar a outro resultado.
    const l = LancamentoComissao.criarDeTaxaDePagamentoOnline({
      ...base,
      taxaTotal: Dinheiro.deCentavos(160),
      parteDoBarbeiro: Dinheiro.deCentavos(72),
    });
    expect(l.percentualAplicado).toBeNull();
  });

  it('recusa parte do barbeiro ZERO — lançamento de zero só sujaria o extrato', () => {
    expect(() =>
      LancamentoComissao.criarDeTaxaDePagamentoOnline({
        ...base,
        taxaTotal: Dinheiro.deCentavos(160),
        parteDoBarbeiro: Dinheiro.deCentavos(0),
      }),
    ).toThrow(InvarianteVioladaError);
  });

  it('★ recusa parte MAIOR que a taxa — o barbeiro não paga mais do que o gateway cobrou', () => {
    expect(() =>
      LancamentoComissao.criarDeTaxaDePagamentoOnline({
        ...base,
        taxaTotal: Dinheiro.deCentavos(160),
        parteDoBarbeiro: Dinheiro.deCentavos(161),
      }),
    ).toThrow(InvarianteVioladaError);
  });

  it('parte IGUAL à taxa é válida (barbeiro a 100%)', () => {
    expect(() =>
      LancamentoComissao.criarDeTaxaDePagamentoOnline({
        ...base,
        taxaTotal: Dinheiro.deCentavos(160),
        parteDoBarbeiro: Dinheiro.deCentavos(160),
      }),
    ).not.toThrow();
  });

  it('★ o saldo cai exatamente pela parte dele', () => {
    // A prova de que "linha própria" e "base reduzida" dão o mesmo total.
    const comissao = LancamentoComissao.criarDeServico({
      id: 'l-1',
      companyId: 'co-1',
      barbeiroId: 'barb-1',
      atendimentoId: 'at-1',
      servicoId: 'svc-1',
      valorBase: Dinheiro.deCentavos(4000),
      percentualAplicado: Percentual.dePontosBase(4500),
      ocorridoEm: base.ocorridoEm,
    });
    const taxa = LancamentoComissao.criarDeTaxaDePagamentoOnline({
      ...base,
      taxaTotal: Dinheiro.deCentavos(160),
      parteDoBarbeiro: Dinheiro.deCentavos(72),
    });
    // 45% de 4000 = 1800; menos 72 = 1728. E 45% de (4000 − 160) = 1728. Igual.
    expect(calcularSaldoCentavos([comissao, taxa])).toBe(1728);
    expect(Percentual.dePontosBase(4500).aplicarEm(Dinheiro.deCentavos(3840)).centavos).toBe(1728);
  });
});

/**
 * Estorno da correção de barbeiro × taxa do pagamento online.
 *
 * Estes dois recursos nasceram em paralelo (2026-08-27) e só se encontraram no
 * merge. O encontro tinha um erro de SINAL que nenhum dos dois lados podia ver
 * sozinho, e é o que estes testes travam.
 */
describe('★ criarDeEstorno — o sinal vem do sinal do original', () => {
  const estornar = (original: LancamentoComissao) =>
    LancamentoComissao.criarDeEstorno({
      id: 'lc-estorno',
      original,
      registradoPorId: 'bar-admin',
      ocorridoEm,
    });

  it('estorno de COMISSÃO subtrai — tira de quem não atendeu', () => {
    const estorno = estornar(criar('svc-corte', 4000));
    expect(estorno.tipo).toBe(TipoLancamento.ESTORNO_COMISSAO);
    expect(sinalDoTipo(estorno.tipo)).toBe(-1);
  });

  it('estorno de DESCONTO_CONCEDIDO soma — devolve o que ele absorveu', () => {
    const desconto = LancamentoComissao.criarDeDescontoConcedido({
      id: 'lc-desc',
      companyId: 'co-1',
      barbeiroId: barbeiro.id,
      atendimentoId: 'at-1',
      descontoTotal: Dinheiro.deCentavos(1000),
      percentualAbsorvido: Percentual.dePorcentagem(50),
      parteDoBarbeiro: Dinheiro.deCentavos(500),
      ocorridoEm,
    });
    expect(sinalDoTipo(estornar(desconto).tipo)).toBe(1);
  });

  it('★ estorno de TAXA_PAGAMENTO_ONLINE SOMA — o bug que o merge criou', () => {
    // A regra anterior era `DESCONTO_CONCEDIDO ? somar : subtrair`, correta
    // enquanto o desconto era o único tipo que subtraía. A taxa também subtrai
    // e caía no `else`: o estorno dela subtrairia DE NOVO, cobrando duas vezes
    // de quem não atendeu uma taxa que ele não devia nem uma vez.
    const taxa = LancamentoComissao.criarDeTaxaDePagamentoOnline({
      id: 'lc-taxa',
      companyId: 'co-1',
      barbeiroId: barbeiro.id,
      atendimentoId: 'at-1',
      taxaTotal: Dinheiro.deCentavos(160),
      parteDoBarbeiro: Dinheiro.deCentavos(79),
      ocorridoEm,
    });
    expect(sinalDoTipo(taxa.tipo)).toBe(-1); // a taxa subtrai...
    expect(sinalDoTipo(estornar(taxa).tipo)).toBe(1); // ...logo o estorno soma
  });

  it('★ o saldo volta EXATAMENTE ao que era — é a prova que importa', () => {
    // Um teste sobre o tipo do estorno pode passar com a regra errada se alguém
    // trocar as duas pontas. Este não: soma o ledger inteiro e exige zero.
    const lancamentos = [
      criar('svc-corte', 4000),
      LancamentoComissao.criarDeTaxaDePagamentoOnline({
        id: 'lc-taxa',
        companyId: 'co-1',
        barbeiroId: barbeiro.id,
        atendimentoId: 'at-1',
        taxaTotal: Dinheiro.deCentavos(160),
        parteDoBarbeiro: Dinheiro.deCentavos(79),
        ocorridoEm,
      }),
    ];
    const comEstornos = [...lancamentos, ...lancamentos.map(estornar)];
    expect(calcularSaldoCentavos(comEstornos)).toBe(0);
  });

  it('um estorno não pode ser estornado', () => {
    expect(() => estornar(estornar(criar('svc-corte', 4000)))).toThrow(InvarianteVioladaError);
  });
});
