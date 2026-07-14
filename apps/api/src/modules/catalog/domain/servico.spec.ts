import { describe, expect, it } from 'vitest';
import { Servico } from './servico.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const base = {
  id: 'svc-1',
  companyId: 'co-1',
  nome: 'Corte',
  precoAvulso: Dinheiro.deCentavos(4000),
  duracao: Duracao.deMinutos(30),
};

describe('Servico', () => {
  it('cria ativo por padrão', () => {
    const s = Servico.criar(base);
    expect(s.ativo).toBe(true);
  });

  it('rejeita preço zero', () => {
    expect(() => Servico.criar({ ...base, precoAvulso: Dinheiro.zero() })).toThrow(
      InvarianteVioladaError,
    );
  });

  it('rejeita nome vazio', () => {
    expect(() => Servico.criar({ ...base, nome: '  ' })).toThrow(InvarianteVioladaError);
  });

  it('desativa em vez de deletar (soft-disable)', () => {
    const s = Servico.criar(base);
    s.desativar();
    expect(s.ativo).toBe(false);
  });

  it('rejeita atualização de preço para zero', () => {
    const s = Servico.criar(base);
    expect(() => s.atualizarPreco(Dinheiro.zero())).toThrow(InvarianteVioladaError);
  });
});
