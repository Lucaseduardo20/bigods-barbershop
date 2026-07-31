import { describe, expect, it } from 'vitest';
import { slugDoNome, slugUnico } from './slug';

describe('slugDoNome', () => {
  it('kebab-case simples', () => {
    expect(slugDoNome('Gabriel')).toBe('gabriel');
    expect(slugDoNome('Lucas Andrade')).toBe('lucas-andrade');
  });

  it('remove acentos', () => {
    expect(slugDoNome('José André')).toBe('jose-andre');
    expect(slugDoNome('João')).toBe('joao');
  });

  it('remove pontuação e espaços extras, sem hífen nas pontas', () => {
    expect(slugDoNome('  Ana-Paula, Jr.  ')).toBe('ana-paula-jr');
  });
});

describe('slugUnico', () => {
  it('devolve o próprio slug quando não há colisão', () => {
    expect(slugUnico('gabriel', new Set())).toBe('gabriel');
  });

  it('acrescenta -2 na primeira colisão, -3 na segunda', () => {
    expect(slugUnico('gabriel', new Set(['gabriel']))).toBe('gabriel-2');
    expect(slugUnico('gabriel', new Set(['gabriel', 'gabriel-2']))).toBe('gabriel-3');
  });
});
