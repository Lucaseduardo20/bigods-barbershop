import { describe, expect, it } from 'vitest';
import { assertConfiguracaoSegura, ConfiguracaoInseguraError } from './config-seguranca';

describe('assertConfiguracaoSegura', () => {
  it('recusa DEMO_MODE=true com NODE_ENV=production (código OTP vazaria)', () => {
    expect(() =>
      assertConfiguracaoSegura({ DEMO_MODE: 'true', NODE_ENV: 'production', IDENTITY_PROVIDER: 'whatsapp' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa IDENTITY_PROVIDER=demo em produção (não envia OTP real)', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'demo', DEMO_MODE: 'false' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa produção sem IDENTITY_PROVIDER definido (default = demo)', () => {
    expect(() => assertConfiguracaoSegura({ NODE_ENV: 'production' })).toThrow(ConfiguracaoInseguraError);
  });

  it('★ aceita produção com IDENTITY_PROVIDER=cognito (OTP por SMS, 2026-08-18)', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'cognito', PAYMENT_GATEWAY: 'fake' }),
    ).not.toThrow();
  });

  it('produção com demo continua recusada, mesmo com o cognito liberado', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'demo', PAYMENT_GATEWAY: 'fake' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('DEMO_MODE=true segue proibido em produção mesmo com cognito', () => {
    expect(() =>
      assertConfiguracaoSegura({
        NODE_ENV: 'production',
        IDENTITY_PROVIDER: 'cognito',
        DEMO_MODE: 'true',
        PAYMENT_GATEWAY: 'fake',
      }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa produção com IDENTITY_PROVIDER desconhecido/inválido (fail closed, nunca cai num default)', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'xyz', PAYMENT_GATEWAY: 'fake' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('aceita dev com DEMO_MODE=true (default de desenvolvimento)', () => {
    expect(() =>
      assertConfiguracaoSegura({ DEMO_MODE: 'true', IDENTITY_PROVIDER: 'demo' }),
    ).not.toThrow();
  });

  it('aceita produção com whatsapp e sem DEMO_MODE', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'whatsapp', PAYMENT_GATEWAY: 'fake' }),
    ).not.toThrow();
  });

  it('aceita produção com whatsapp mesmo com DEMO_MODE=false explícito', () => {
    expect(() =>
      assertConfiguracaoSegura({
        NODE_ENV: 'production',
        IDENTITY_PROVIDER: 'whatsapp',
        DEMO_MODE: 'false',
        PAYMENT_GATEWAY: 'fake',
      }),
    ).not.toThrow();
  });

  it('aceita produção com whatsapp + PAYMENT_GATEWAY=fake (essencial: presencial-only sem AWS nem gateway online)', () => {
    expect(() =>
      assertConfiguracaoSegura({ NODE_ENV: 'production', IDENTITY_PROVIDER: 'whatsapp', PAYMENT_GATEWAY: 'fake' }),
    ).not.toThrow();
  });

  const whatsappProd = { NODE_ENV: 'production', IDENTITY_PROVIDER: 'whatsapp' } as const;

  it('recusa PAYMENT_GATEWAY=abacatepay sem ABACATEPAY_API_KEY', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...whatsappProd, PAYMENT_GATEWAY: 'abacatepay', ABACATEPAY_WEBHOOK_SECRET: 's' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa abacatepay sem ABACATEPAY_WEBHOOK_SECRET (webhook exposto sem validação)', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...whatsappProd, PAYMENT_GATEWAY: 'abacatepay', ABACATEPAY_API_KEY: 'k' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa produção com gateway default (abacatepay) sem credenciais', () => {
    expect(() => assertConfiguracaoSegura({ ...whatsappProd })).toThrow(ConfiguracaoInseguraError);
  });

  it('aceita abacatepay com API key e webhook secret', () => {
    expect(() =>
      assertConfiguracaoSegura({
        ...whatsappProd,
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
