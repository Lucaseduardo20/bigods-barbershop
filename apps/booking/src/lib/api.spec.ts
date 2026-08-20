import { describe, expect, it } from 'vitest';
import { mensagemDeLimite } from './api';

/**
 * O 429 chegava na tela como "ThrottlerException: Too Many Requests" — texto do
 * framework, em inglês, sem dizer o que fazer. O que importa aqui é a mensagem
 * ser acionável e nunca vazar jargão, inclusive quando o header some (CORS mal
 * configurado, proxy que remove, etc.).
 */
describe('mensagemDeLimite', () => {
  it('arredonda pra cima: 601s vira "11 minutos" (nunca "10,01")', () => {
    expect(mensagemDeLimite(601)).toBe(
      'Muitas tentativas. Aguarde cerca de 11 minutos e tente de novo.',
    );
  });

  it('usa singular abaixo de um minuto', () => {
    expect(mensagemDeLimite(30)).toBe(
      'Muitas tentativas. Aguarde cerca de 1 minuto e tente de novo.',
    );
  });

  it('janela típica do limite por telefone (10 min)', () => {
    expect(mensagemDeLimite(600)).toBe(
      'Muitas tentativas. Aguarde cerca de 10 minutos e tente de novo.',
    );
  });

  it('sem header legível cai numa mensagem genérica, nunca em "NaN minutos"', () => {
    for (const entrada of [null, Number.NaN, 0, -5]) {
      expect(mensagemDeLimite(entrada)).toBe(
        'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
      );
    }
  });
});
