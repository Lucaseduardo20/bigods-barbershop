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

  describe('CRUD completo (sessão 2026-08-17, Parte 1)', () => {
    it('renomeia (o controller aceitava `nome` no PATCH e descartava em silêncio — não existia o método)', () => {
      const s = Servico.criar(base);
      s.atualizarNome('  Corte Degradê  ');
      expect(s.nome).toBe('Corte Degradê');
    });

    it('rejeita renomear para vazio — mesma invariante da criação', () => {
      const s = Servico.criar(base);
      expect(() => s.atualizarNome('   ')).toThrow(InvarianteVioladaError);
      expect(s.nome).toBe('Corte');
    });

    it('atualiza duração (vale só para agendamentos futuros — ItemAtendido guarda snapshot)', () => {
      const s = Servico.criar(base);
      s.atualizarDuracao(Duracao.deMinutos(45));
      expect(s.duracao.minutos).toBe(45);
    });
  });
});
