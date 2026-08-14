import { describe, expect, it } from 'vitest';
import {
  CandidatoAAtribuicao,
  escolherBarbeiroSemPreferencia,
} from './regra-atribuicao-de-barbeiro';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * A cascata decide quem atende o cliente que não escolheu barbeiro. O que
 * importa testar é a ORDEM dos critérios (um critério posterior nunca pode
 * atropelar um anterior) e o determinismo — "aleatório" só pode entrar no
 * último empate, nunca antes.
 */
const candidato = (
  barbeiroId: string,
  comissaoTotalCentavos: number,
  agendamentosNoDia = 0,
): CandidatoAAtribuicao => ({ barbeiroId, comissaoTotalCentavos, agendamentosNoDia });

/** Sorteio fixo, para o teste não depender de sorte. */
const primeiro = () => 0;

describe('escolherBarbeiroSemPreferencia', () => {
  it('1º critério: escolhe o de MENOR comissão', () => {
    const escolhido = escolherBarbeiroSemPreferencia(
      [candidato('caro', 3000), candidato('barato', 1800), candidato('medio', 2200)],
      primeiro,
    );
    expect(escolhido).toBe('barato');
  });

  it('menor comissão vence mesmo que ele esteja MAIS carregado no dia', () => {
    // O 2º critério só existe para desempatar o 1º — nunca para atropelá-lo.
    const escolhido = escolherBarbeiroSemPreferencia(
      [candidato('barato', 1800, 9), candidato('caro', 3000, 0)],
      primeiro,
    );
    expect(escolhido).toBe('barato');
  });

  it('2º critério: empate de comissão → o com MENOS agendamentos no dia', () => {
    const escolhido = escolherBarbeiroSemPreferencia(
      [candidato('cheio', 2000, 5), candidato('vazio', 2000, 1), candidato('caro', 4000, 0)],
      primeiro,
    );
    expect(escolhido).toBe('vazio');
  });

  it('3º critério: empate total → sorteio, e só aí', () => {
    const empatados = [candidato('a', 2000, 2), candidato('b', 2000, 2), candidato('c', 2000, 2)];
    expect(escolherBarbeiroSemPreferencia(empatados, () => 1)).toBe('b');
    expect(escolherBarbeiroSemPreferencia(empatados, () => 2)).toBe('c');
  });

  it('o sorteio opera sobre lista ordenada — não depende da ordem que o banco devolveu', () => {
    const umaOrdem = [candidato('c', 2000), candidato('a', 2000), candidato('b', 2000)];
    const outraOrdem = [candidato('b', 2000), candidato('c', 2000), candidato('a', 2000)];
    // Mesmo índice de sorteio → mesmo barbeiro, venha na ordem que vier.
    expect(escolherBarbeiroSemPreferencia(umaOrdem, () => 0)).toBe(
      escolherBarbeiroSemPreferencia(outraOrdem, () => 0),
    );
  });

  it('candidato único é escolhido sem passar por desempate', () => {
    expect(escolherBarbeiroSemPreferencia([candidato('unico', 5000, 99)], primeiro)).toBe('unico');
  });

  it('sem candidatos, falha com mensagem acionável em vez de escolher ninguém', () => {
    expect(() => escolherBarbeiroSemPreferencia([], primeiro)).toThrow(InvarianteVioladaError);
  });

  it('índice de sorteio fora da faixa não quebra (defensivo)', () => {
    const empatados = [candidato('a', 100), candidato('b', 100)];
    expect(['a', 'b']).toContain(escolherBarbeiroSemPreferencia(empatados, () => 99));
    expect(['a', 'b']).toContain(escolherBarbeiroSemPreferencia(empatados, () => -3));
  });
});
