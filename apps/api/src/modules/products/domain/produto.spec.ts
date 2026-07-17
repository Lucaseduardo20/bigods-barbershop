import { describe, expect, it } from 'vitest';
import { Produto } from './produto.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const criar = (sobrescrever: Partial<Parameters<typeof Produto.criar>[0]> = {}) =>
  Produto.criar({
    id: 'prod-1',
    companyId: 'co-1',
    nome: 'Pomada Modeladora',
    preco: Dinheiro.deCentavos(3500),
    ...sobrescrever,
  });

describe('Produto', () => {
  it('cria com ativo=true por padrão', () => {
    const p = criar();
    expect(p.ativo).toBe(true);
    expect(p.nome).toBe('Pomada Modeladora');
  });

  it('exige nome não-vazio', () => {
    expect(() => criar({ nome: '  ' })).toThrow(InvarianteVioladaError);
  });

  it('exige preço positivo', () => {
    expect(() => criar({ preco: Dinheiro.zero() })).toThrow(InvarianteVioladaError);
  });

  it('desativar/reativar — nunca deletar (soft-disable como Servico)', () => {
    const p = criar();
    p.desativar();
    expect(p.ativo).toBe(false);
    p.reativar();
    expect(p.ativo).toBe(true);
  });

  it('atualizarPreco exige positivo', () => {
    const p = criar();
    expect(() => p.atualizarPreco(Dinheiro.zero())).toThrow(InvarianteVioladaError);
    p.atualizarPreco(Dinheiro.deCentavos(4000));
    expect(p.preco.centavos).toBe(4000);
  });

  it('atualizarNome trima e exige não-vazio', () => {
    const p = criar();
    p.atualizarNome('  Gel Fixador  ');
    expect(p.nome).toBe('Gel Fixador');
    expect(() => p.atualizarNome('')).toThrow(InvarianteVioladaError);
  });
});
