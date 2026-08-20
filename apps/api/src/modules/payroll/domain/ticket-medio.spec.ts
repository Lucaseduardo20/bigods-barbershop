import { describe, expect, it } from 'vitest';
import { ticketMedioCentavos } from './ticket-medio';

describe('ticketMedioCentavos', () => {
  it('★ conjunto conhecido, conferido à mão: 3 visitas, com e sem produto', () => {
    // Visita 1: Corte 4000                            = 4000
    // Visita 2: Corte 4000 + Barba 3000               = 7000
    // Visita 3: Corte 4000 + Pomada 3500 (produto)    = 7500
    const faturamento = 4000 + 7000 + 7500; // 18500
    expect(ticketMedioCentavos(faturamento, 3)).toBe(6167); // 18500/3 = 6166,67
  });

  it('divisão exata não arredonda nada', () => {
    expect(ticketMedioCentavos(9000, 3)).toBe(3000);
  });

  it('arredonda para o centavo mais próximo, pra cima e pra baixo', () => {
    expect(ticketMedioCentavos(1000 + 1000 + 1100, 3)).toBe(1033); // 1033,33 → 1033
    expect(ticketMedioCentavos(1000 + 1100 + 1100, 3)).toBe(1067); // 1066,67 → 1067
  });

  it('★ mês sem atendimento concluído devolve null — nunca divide por zero', () => {
    expect(ticketMedioCentavos(0, 0)).toBeNull();
    // Faturamento sem atendimento concluído não deveria acontecer, mas se
    // acontecer o resultado continua sendo "não dá pra dizer", não Infinity.
    expect(ticketMedioCentavos(5000, 0)).toBeNull();
    expect(ticketMedioCentavos(5000, -1)).toBeNull();
  });

  it('uma visita só: o ticket médio é ela mesma', () => {
    expect(ticketMedioCentavos(7500, 1)).toBe(7500);
  });

  it('mês sem faturamento mas com atendimento (tudo por crédito de pacote) dá zero, não null', () => {
    // Zero é uma resposta legítima e diferente de "não houve movimento".
    expect(ticketMedioCentavos(0, 4)).toBe(0);
  });

  it('recusa entrada não-inteira — centavo é inteiro, float aqui é bug de origem', () => {
    expect(() => ticketMedioCentavos(1000.5, 3)).toThrow(/inteiros/);
    expect(() => ticketMedioCentavos(1000, 2.5)).toThrow(/inteiros/);
  });
});
