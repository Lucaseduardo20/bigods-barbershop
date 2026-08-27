import { describe, expect, it } from 'vitest';
import { StatusItemPacote } from '@bigods/contracts';
import { nomeDoPacote } from './Home';

/**
 * Como o pacote se chama na conta do cliente (2026-08-26). Antes a tela
 * escrevia "Pacote" para todo mundo, o que não dizia nada sobre o que ele
 * comprou.
 */
const item = (servicoNome: string) => ({
  id: `i-${servicoNome}-${Math.random()}`,
  servicoId: 's',
  servicoNome,
  servicoDuracaoMinutos: 30,
  valorRateadoCentavos: 1000,
  status: StatusItemPacote.DISPONIVEL,
  faltasComputadas: 0,
  prazoReagendamentoAte: null,
  atendimentoId: null,
  atendimentoInicio: null,
});

describe('nome do pacote', () => {
  it('usa o nome da oferta quando existe', () => {
    expect(
      nomeDoPacote({ nomeOferta: 'Combo 4 Cortes Simples', itens: [item('Corte Simples')] }),
    ).toBe('Combo 4 Cortes Simples');
  });

  it('★ sem nome, deriva da composição — nunca o genérico "Pacote"', () => {
    // Venda avulsa pelo painel, ou venda antiga que o backfill por composição
    // não conseguiu identificar com segurança.
    expect(
      nomeDoPacote({
        nomeOferta: null,
        itens: [item('Corte Simples'), item('Corte Simples'), item('Corte Simples'), item('Corte Simples')],
      }),
    ).toBe('4× Corte Simples');
  });

  it('agrupa serviços diferentes, na ordem em que aparecem', () => {
    expect(
      nomeDoPacote({
        nomeOferta: null,
        itens: [item('Corte'), item('Barba'), item('Corte')],
      }),
    ).toBe('2× Corte + 1× Barba');
  });

  it('pacote sem itens não quebra a tela', () => {
    expect(nomeDoPacote({ nomeOferta: null, itens: [] })).toBe('Pacote');
  });
});
