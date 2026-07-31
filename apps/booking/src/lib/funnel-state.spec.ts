import { describe, expect, it } from 'vitest';
import { aplicarBarbeiroDoLink, estadoInicial, PASSO, sanitizarEstadoCarregado } from './funnel-state';

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

describe('aplicarBarbeiroDoLink', () => {
  it('§4b: um link de barbeiro descarta progresso salvo de outro barbeiro, não só sobrescreve o campo', () => {
    // não recebe o estado salvo como entrada de propósito — o link sempre
    // vence por completo, nunca faz merge parcial com progresso anterior.
    const estado = aplicarBarbeiroDoLink('bar-gabriel', 'Gabriel');
    expect(estado.barbeiroId).toBe('bar-gabriel');
    expect(estado.barbeiroNome).toBe('Gabriel');
    expect(estado.barbeiroFixadoPorLink).toBe(true);
    expect(estado.step).toBe(PASSO.LANDING); // só a etapa de ESCOLHER é pulada, não a landing
    expect(estado.servicoIds).toEqual([]); // nada de seleção antiga de um barbeiro diferente sobrevive
  });
});
