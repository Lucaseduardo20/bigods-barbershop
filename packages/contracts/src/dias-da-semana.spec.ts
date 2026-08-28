import { describe, expect, it } from 'vitest';
import {
  descricaoCurtaDosDias,
  descricaoDosDias,
  diasNormalizados,
  permiteTodosOsDias,
} from './dias-da-semana';

/**
 * ★ A frase que o cliente lê SAI da mesma configuração que bloqueia. Se ela
 * divergir, alguém compra lendo "todos os dias" e descobre no sábado que não
 * pode — e tem razão em reclamar.
 */
describe('descrição derivada dos dias', () => {
  it('todos os sete dias', () => {
    expect(descricaoDosDias([0, 1, 2, 3, 4, 5, 6])).toBe('Válido todos os dias');
  });

  it('★ faixa contígua vira "de X a Y"', () => {
    expect(descricaoDosDias([1, 2, 3, 4])).toBe('Válido de segunda a quinta');
    expect(descricaoDosDias([1, 2, 3, 4, 5])).toBe('Válido de segunda a sexta');
  });

  it('a ordem da entrada não importa — a leitura começa na segunda', () => {
    expect(descricaoDosDias([4, 1, 3, 2])).toBe('Válido de segunda a quinta');
  });

  it('dias avulsos viram lista', () => {
    expect(descricaoDosDias([1, 3, 5])).toBe('Válido às segundas, quartas e sextas');
  });

  it('★ dois dias contíguos são LISTA, não faixa — ninguém diz "de terça a quarta"', () => {
    expect(descricaoDosDias([2, 3])).toBe('Válido às terças e quartas');
    expect(descricaoCurtaDosDias([2, 3])).toBe('ter e qua');
  });

  it('um dia só', () => {
    expect(descricaoDosDias([2])).toBe('Válido só às terças');
    expect(descricaoDosDias([6])).toBe('Válido só aos sábados');
  });

  it('★ sábado+domingo+segunda NÃO vira faixa — "de sábado a segunda" enganaria', () => {
    // Na ordem de leitura (seg→dom) esses dias não são contíguos, e dizer
    // "de sábado a segunda" faria o cliente achar que terça também vale.
    expect(descricaoDosDias([6, 0, 1])).toBe('Válido às segundas, sábados e domingos');
  });

  it('a faixa que termina no domingo é contígua na ordem de leitura', () => {
    expect(descricaoDosDias([4, 5, 6, 0])).toBe('Válido de quinta a domingo');
  });
});

describe('normalização', () => {
  it('★ vazio/nulo = TODOS os dias — é o default de quem nunca configurou', () => {
    // Tratar "sem restrição" como "nenhum dia" tornaria o pacote inutilizável,
    // e é exatamente o estado de toda oferta anterior a esta regra.
    expect(diasNormalizados([])).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(diasNormalizados(null)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(diasNormalizados(undefined)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(descricaoDosDias([])).toBe('Válido todos os dias');
  });

  it('descarta repetidos e valores fora de 0–6', () => {
    expect(diasNormalizados([1, 1, 2, 9, -3, 2])).toEqual([1, 2]);
  });

  it('permiteTodosOsDias', () => {
    expect(permiteTodosOsDias([0, 1, 2, 3, 4, 5, 6])).toBe(true);
    expect(permiteTodosOsDias([])).toBe(true);
    expect(permiteTodosOsDias([1, 2, 3, 4])).toBe(false);
  });
});

describe('versão curta, para caber num chip', () => {
  it('cobre as três formas', () => {
    expect(descricaoCurtaDosDias([0, 1, 2, 3, 4, 5, 6])).toBe('todos os dias');
    expect(descricaoCurtaDosDias([1, 2, 3, 4])).toBe('seg a qui');
    expect(descricaoCurtaDosDias([1, 3, 5])).toBe('seg, qua e sex');
    expect(descricaoCurtaDosDias([6])).toBe('sáb');
  });
});
