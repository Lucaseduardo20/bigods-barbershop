import { describe, expect, it } from 'vitest';
import { Papel } from '@bigods/contracts';
import { Barbeiro } from './barbeiro.aggregate';
import { Percentual } from '../../../shared/domain/percentual';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const criar = (excecoes?: Map<string, Percentual>) =>
  Barbeiro.criar({
    id: 'bar-1',
    companyId: 'co-1',
    nome: 'Gabriel',
    papeis: new Set([Papel.ADMIN, Papel.BARBEIRO]),
    comissaoPadrao: Percentual.dePorcentagem(45),
    excecoesComissao: excecoes,
    servicosAtendidos: new Set(['svc-corte', 'svc-barba']),
  });

describe('Barbeiro — matriz de comissão', () => {
  it('sem exceção, aplica o percentual padrão', () => {
    expect(criar().percentualPara('svc-corte').porcentagem).toBe(45);
  });

  it('com exceção por serviço, a exceção vence', () => {
    const b = criar(new Map([['svc-barba', Percentual.dePorcentagem(60)]]));
    expect(b.percentualPara('svc-barba').porcentagem).toBe(60);
    expect(b.percentualPara('svc-corte').porcentagem).toBe(45);
  });

  it('remover exceção volta ao padrão', () => {
    const b = criar(new Map([['svc-barba', Percentual.dePorcentagem(60)]]));
    b.removerExcecaoComissao('svc-barba');
    expect(b.percentualPara('svc-barba').porcentagem).toBe(45);
  });

  it('comissão fora de 0-100% é impossível (garantida pelo VO)', () => {
    expect(() => Percentual.dePorcentagem(101)).toThrow(InvarianteVioladaError);
  });
});

describe('Barbeiro — serviços atendidos', () => {
  it('só atende serviços habilitados', () => {
    const b = criar();
    expect(b.atende('svc-corte')).toBe(true);
    expect(b.atende('svc-quimica')).toBe(false);
  });

  it('exige ao menos um papel', () => {
    expect(() =>
      Barbeiro.criar({
        id: 'x',
        companyId: 'co-1',
        nome: 'X',
        papeis: new Set(),
        comissaoPadrao: Percentual.dePorcentagem(45),
      }),
    ).toThrow(InvarianteVioladaError);
  });
});

describe('Barbeiro — comissão sobre produto (item 4, sessão 2026-07-16)', () => {
  it('default 0% quando não informado', () => {
    expect(criar().comissaoProdutos.porcentagem).toBe(0);
  });

  it('percentual ÚNICO para todos os produtos — sem matriz por produto', () => {
    const b = Barbeiro.criar({
      id: 'bar-2',
      companyId: 'co-1',
      nome: 'Pedro',
      papeis: new Set([Papel.BARBEIRO]),
      comissaoPadrao: Percentual.dePorcentagem(45),
      comissaoProdutos: Percentual.dePorcentagem(12),
      servicosAtendidos: new Set(),
    });
    expect(b.comissaoProdutos.porcentagem).toBe(12);
  });

  it('definirComissaoProdutos atualiza o percentual', () => {
    const b = criar();
    b.definirComissaoProdutos(Percentual.dePorcentagem(15));
    expect(b.comissaoProdutos.porcentagem).toBe(15);
  });
});
