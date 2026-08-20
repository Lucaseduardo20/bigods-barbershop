import { describe, expect, it } from 'vitest';
import { mensagemDeLimite } from './api';

/**
 * Mesma garantia do booking (`apps/booking/src/lib/api.spec.ts`): o cliente
 * nunca vê "ThrottlerException: Too Many Requests", e sim quanto esperar —
 * inclusive quando o header do Retry-After não chega legível.
 */
describe('mensagemDeLimite', () => {
  it('arredonda pra cima e pluraliza', () => {
    expect(mensagemDeLimite(601)).toBe(
      'Muitas tentativas. Aguarde cerca de 11 minutos e tente de novo.',
    );
    expect(mensagemDeLimite(600)).toBe(
      'Muitas tentativas. Aguarde cerca de 10 minutos e tente de novo.',
    );
  });

  it('usa singular abaixo de um minuto', () => {
    expect(mensagemDeLimite(30)).toBe(
      'Muitas tentativas. Aguarde cerca de 1 minuto e tente de novo.',
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
