import { describe, expect, it } from 'vitest';
import { MotivoDaFalhaDeEstorno, motivoOperacionalDoEstorno } from './dto';

/**
 * Classificação do erro CRU do gateway em linguagem de operação.
 *
 * Mora em `contracts` porque é a mesma classificação que a tela do admin
 * renderiza e que a API usa para decidir se vale retentar — duas implementações
 * divergiriam exatamente no caso que importa.
 */
describe('motivoOperacionalDoEstorno', () => {
  it('★ saldo insuficiente — o motivo mais provável, e o único que o dono resolve sozinho', () => {
    // A doc do Mercado Pago é explícita que o estorno exige saldo disponível, e a
    // operação saca o saldo para pagar barbeiro (followup #1).
    for (const erro of [
      'insufficient_funds',
      'Not enough balance to process the refund',
      'HTTP 400 (insufficient_amount)',
      'saldo indisponível na conta',
    ]) {
      expect(motivoOperacionalDoEstorno(erro), erro).toBe(
        MotivoDaFalhaDeEstorno.SALDO_INSUFICIENTE,
      );
    }
  });

  it('prazo vencido', () => {
    for (const erro of [
      'refund period expired',
      'payment is too old to be refunded',
      'HTTP 400 (not_refundable)',
      'prazo de estorno vencido',
    ]) {
      expect(motivoOperacionalDoEstorno(erro), erro).toBe(MotivoDaFalhaDeEstorno.PRAZO_VENCIDO);
    }
  });

  it('indisponibilidade — retentar resolve', () => {
    for (const erro of [
      'HTTP 503 (service_unavailable)',
      'Timeout ao falar com o gateway',
      'ECONNRESET',
      'HTTP 502',
      'internal_error',
    ]) {
      expect(motivoOperacionalDoEstorno(erro), erro).toBe(MotivoDaFalhaDeEstorno.INDISPONIVEL);
    }
  });

  it('★★ o default é DESCONHECIDO, NÃO indisponível', () => {
    // Tratar erro novo como "retentar resolve" faria o job bater no gateway para
    // sempre por um motivo que nunca vai passar. Desconhecido pede um humano — que
    // é a resposta honesta quando não se sabe.
    expect(motivoOperacionalDoEstorno('motivo_que_o_mp_criou_ontem')).toBe(
      MotivoDaFalhaDeEstorno.DESCONHECIDO,
    );
    expect(motivoOperacionalDoEstorno('HTTP 422 (algo_novo)')).toBe(
      MotivoDaFalhaDeEstorno.DESCONHECIDO,
    );
  });

  it('null e vazio caem em DESCONHECIDO sem quebrar', () => {
    expect(motivoOperacionalDoEstorno(null)).toBe(MotivoDaFalhaDeEstorno.DESCONHECIDO);
    expect(motivoOperacionalDoEstorno('')).toBe(MotivoDaFalhaDeEstorno.DESCONHECIDO);
  });

  it('é insensível a maiúsculas', () => {
    expect(motivoOperacionalDoEstorno('INSUFFICIENT FUNDS')).toBe(
      MotivoDaFalhaDeEstorno.SALDO_INSUFICIENTE,
    );
  });
});
