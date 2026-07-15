import { describe, expect, it } from 'vitest';
import { assertConfiguracaoSegura, ConfiguracaoInseguraError } from './config-seguranca';

describe('assertConfiguracaoSegura', () => {
  it('recusa DEMO_MODE=true com NODE_ENV=production (código OTP vazaria)', () => {
    expect(() =>
      assertConfiguracaoSegura({ DEMO_MODE: 'true', NODE_ENV: 'production', IDENTITY_PROVIDER: 'cognito' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa IDENTITY_PROVIDER=demo em produção (não envia SMS real)', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'demo', DEMO_MODE: 'false' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa produção sem IDENTITY_PROVIDER definido (default = demo)', () => {
    expect(() => assertConfiguracaoSegura({ NODE_ENV: 'production' })).toThrow(ConfiguracaoInseguraError);
  });

  it('aceita dev com DEMO_MODE=true (default de desenvolvimento)', () => {
    expect(() =>
      assertConfiguracaoSegura({ DEMO_MODE: 'true', IDENTITY_PROVIDER: 'demo' }),
    ).not.toThrow();
  });

  it('aceita produção com cognito e sem DEMO_MODE', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'cognito', PAYMENT_GATEWAY: 'fake' }),
    ).not.toThrow();
  });

  it('aceita produção com cognito mesmo com DEMO_MODE=false explícito', () => {
    expect(() =>
      assertConfiguracaoSegura({
        NODE_ENV: 'production',
        IDENTITY_PROVIDER: 'cognito',
        DEMO_MODE: 'false',
        PAYMENT_GATEWAY: 'fake',
      }),
    ).not.toThrow();
  });

  const cognitoProd = { NODE_ENV: 'production', IDENTITY_PROVIDER: 'cognito' } as const;

  it('recusa PAYMENT_GATEWAY=abacatepay sem ABACATEPAY_API_KEY', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...cognitoProd, PAYMENT_GATEWAY: 'abacatepay', ABACATEPAY_WEBHOOK_SECRET: 's' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa abacatepay sem ABACATEPAY_WEBHOOK_SECRET (webhook exposto sem validação)', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...cognitoProd, PAYMENT_GATEWAY: 'abacatepay', ABACATEPAY_API_KEY: 'k' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa produção com gateway default (abacatepay) sem credenciais', () => {
    expect(() => assertConfiguracaoSegura({ ...cognitoProd })).toThrow(ConfiguracaoInseguraError);
  });

  it('aceita abacatepay com API key e webhook secret', () => {
    expect(() =>
      assertConfiguracaoSegura({
        ...cognitoProd,
        PAYMENT_GATEWAY: 'abacatepay',
        ABACATEPAY_API_KEY: 'k',
        ABACATEPAY_WEBHOOK_SECRET: 's',
      }),
    ).not.toThrow();
  });

  it('aceita dev com PAYMENT_GATEWAY=fake sem credenciais de gateway', () => {
    expect(() =>
      assertConfiguracaoSegura({ IDENTITY_PROVIDER: 'demo', DEMO_MODE: 'true', PAYMENT_GATEWAY: 'fake' }),
    ).not.toThrow();
  });
});
