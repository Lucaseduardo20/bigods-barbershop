import { describe, expect, it } from 'vitest';
import { instanteDaExecucao, lerConfigReembolso, validarPrazoDias } from './reembolso';

describe('lerConfigReembolso', () => {
  it('sem env, usa o padrão de 31 dias (decisão do dono)', () => {
    expect(lerConfigReembolso({}).prazoDiasPadrao).toBe(31);
  });

  it('env vazia também cai no padrão — é o estado do .env.example', () => {
    expect(lerConfigReembolso({ REEMBOLSO_PRAZO_DIAS: '' }).prazoDiasPadrao).toBe(31);
  });

  it('lê o valor configurado', () => {
    expect(lerConfigReembolso({ REEMBOLSO_PRAZO_DIAS: '7' }).prazoDiasPadrao).toBe(7);
  });

  it('★ ZERO é válido e significa "executar agora"', () => {
    // É como "imediato" é expresso, sem um segundo campo booleano para a mesma
    // coisa. Se `0` fosse tratado como ausente, o deploy que quer execução na hora
    // ganharia 31 dias de espera silenciosamente.
    expect(lerConfigReembolso({ REEMBOLSO_PRAZO_DIAS: '0' }).prazoDiasPadrao).toBe(0);
  });
});

describe('★ validarPrazoDias — a mesma regra na env e no request', () => {
  it('ausente devolve o padrão passado', () => {
    expect(validarPrazoDias(undefined, 31)).toBe(31);
    expect(validarPrazoDias('', 31)).toBe(31);
  });

  it('aceita número e string', () => {
    expect(validarPrazoDias(7, 31)).toBe(7);
    expect(validarPrazoDias('7', 31)).toBe(7);
  });

  it('★ recusa o que viraria uma data errada sem ninguém revisar depois', () => {
    for (const invalido of ['31 dias', 'abc', '-1', '7.5', '1e3', 'NaN']) {
      expect(() => validarPrazoDias(invalido, 31), invalido).toThrow(/Prazo de reembolso inválido/);
    }
    expect(() => validarPrazoDias(-1, 31)).toThrow();
    expect(() => validarPrazoDias(7.5, 31)).toThrow();
  });

  it('★★ recusa acima de 180 — é o prazo máximo de estorno de cartão no MP', () => {
    // Agendar além disso garantiria falha no dia da execução, depois de o cliente
    // ter esperado meio ano. É o pior momento possível para descobrir.
    expect(validarPrazoDias(180, 31)).toBe(180);
    expect(() => validarPrazoDias(181, 31)).toThrow(/180/);
  });

  it('a mensagem explica a unidade e o zero', () => {
    expect(() => validarPrazoDias('2.5', 31)).toThrow(/0 = executar agora/);
  });
});

describe('instanteDaExecucao', () => {
  const agora = new Date('2026-08-27T12:00:00.000Z');

  it('soma os dias em milissegundos', () => {
    expect(instanteDaExecucao(agora, 31).toISOString()).toBe('2026-09-27T12:00:00.000Z');
  });

  it('prazo zero é o próprio instante — "agora"', () => {
    expect(instanteDaExecucao(agora, 0).getTime()).toBe(agora.getTime());
  });

  it('★ soma em INSTANTE, não em dia civil — não depende de fuso nem de horário de verão', () => {
    // O agendamento é um prazo de espera, não uma data de calendário. Um cálculo
    // por dia civil traria fuso para dentro de uma decisão que não depende dele.
    // A prova: o resultado é o mesmo instante independentemente do TZ do processo,
    // porque `getTime()` é absoluto.
    const trintaEUmDias = 31 * 86_400_000;
    expect(instanteDaExecucao(agora, 31).getTime() - agora.getTime()).toBe(trintaEUmDias);
  });

  it('não muta a data recebida', () => {
    const copia = new Date(agora.getTime());
    instanteDaExecucao(agora, 31);
    expect(agora).toEqual(copia);
  });
});
