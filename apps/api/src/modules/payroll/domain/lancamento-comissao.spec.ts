import { describe, expect, it } from 'vitest';
import { Papel } from '@bigods/contracts';
import { LancamentoComissao } from './lancamento-comissao.aggregate';
import { Barbeiro } from '../../staff/domain/barbeiro.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';

const ocorridoEm = new Date(Date.UTC(2026, 6, 15, 12));

const barbeiro = Barbeiro.criar({
  id: 'bar-1',
  companyId: 'co-1',
  nome: 'Gabriel',
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
