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
  LancamentoComissao.criar({
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
});
