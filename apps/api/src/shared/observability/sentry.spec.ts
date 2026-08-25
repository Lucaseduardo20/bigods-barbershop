import * as Sentry from '@sentry/nestjs';
import { afterEach, describe, expect, it } from 'vitest';
import { iniciarSentry } from './sentry';

/**
 * A REGRA de limpeza é testada em `@bigods/contracts`, sem SDK. Aqui se testa a
 * LIGAÇÃO: que a chave que liga o Sentry é o DSN, e que o filtro está de fato
 * plugado no cliente — não adianta a regra ser perfeita se ninguém a chamou.
 *
 * O DSN é falso e nenhum evento é capturado, então nada sai pela rede.
 */
const DSN_FALSO = 'https://exemplo@o0.ingest.sentry.io/0';

afterEach(async () => {
  delete process.env.SENTRY_DSN;
  delete process.env.SENTRY_TRACES_SAMPLE_RATE;
  await Sentry.close();
});

describe('★ sem DSN o Sentry fica inerte', () => {
  it('não inicializa cliente nenhum', () => {
    delete process.env.SENTRY_DSN;
    expect(iniciarSentry()).toBe(false);
    expect(Sentry.getClient()).toBeUndefined();
  });

  it('DSN só com espaço em branco conta como ausente', () => {
    process.env.SENTRY_DSN = '   ';
    expect(iniciarSentry()).toBe(false);
  });
});

describe('★ com DSN, o filtro de PII está plugado', () => {
  it('o beforeSend do cliente apaga o corpo de rota sensível', () => {
    process.env.SENTRY_DSN = DSN_FALSO;
    expect(iniciarSentry()).toBe(true);

    const beforeSend = Sentry.getClient()?.getOptions().beforeSend;
    expect(beforeSend).toBeTypeOf('function');

    const limpo = beforeSend!(
      {
        request: { url: '/conta/login/confirmar', data: { codigo: '123456' } },
        user: { id: 'uuid-1', email: 'r@x.com' },
      } as never,
      {} as never,
    );

    const texto = JSON.stringify(limpo);
    expect(texto).not.toContain('123456');
    expect(texto).not.toContain('r@x.com');
    expect(texto).toContain('uuid-1');
  });

  it('taxa de tracing vem da env, e valor inválido cai no default', () => {
    process.env.SENTRY_DSN = DSN_FALSO;
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.5';
    iniciarSentry();
    expect(Sentry.getClient()?.getOptions().tracesSampleRate).toBe(0.5);
  });

  it('taxa fora da faixa não desliga o tracing em silêncio', async () => {
    process.env.SENTRY_DSN = DSN_FALSO;
    process.env.SENTRY_TRACES_SAMPLE_RATE = 'meio';
    iniciarSentry();
    expect(Sentry.getClient()?.getOptions().tracesSampleRate).toBe(0.15);
  });
});
