import { describe, expect, it } from 'vitest';
import { estadoInicial, PASSO, sanitizarEstadoCarregado } from './funnel-state';

describe('sanitizarEstadoCarregado', () => {
  it('mantém o estado salvo quando a compra não foi concluída', () => {
    const bruto = { step: PASSO.CONFIRMACAO, nome: 'João', concluido: false };
    expect(sanitizarEstadoCarregado(bruto)).toMatchObject({ step: PASSO.CONFIRMACAO, nome: 'João' });
  });

  it('bug 1: nunca resume no passo de confirmação de uma compra já concluída (pago)', () => {
    // Simula o sessionStorage salvo logo após pagar um pacote: step ainda é
    // CONFIRMACAO na hora do último patch antes de concluir. Um refresh/reabertura
    // da aba não pode devolver o cliente para a tela de pagamento de um pacote PAGO.
    const brutoPosCompra = {
      step: PASSO.CONFIRMACAO,
      modo: 'pacote' as const,
      ofertaId: 'oferta-1',
      formaPagamento: 'online' as const,
      concluido: true,
    };
    const saneado = sanitizarEstadoCarregado(brutoPosCompra);
    expect(saneado.step).toBe(PASSO.LANDING);
    expect(saneado).toEqual(estadoInicial);
  });
});
