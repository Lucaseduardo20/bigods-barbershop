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
        // Fase 8 (2026-08-27): obrigatória — a AbacatePay não informa líquido.
        ABACATEPAY_TAXA_BASIS_POINTS: '299',
      }),
    ).not.toThrow();
  });

  it('aceita dev com PAYMENT_GATEWAY=fake sem credenciais de gateway', () => {
    expect(() =>
      assertConfiguracaoSegura({ IDENTITY_PROVIDER: 'demo', DEMO_MODE: 'true', PAYMENT_GATEWAY: 'fake' }),
    ).not.toThrow();
  });

  // Pagamento manual por WhatsApp (TEMPORÁRIO, 2026-08-18).
  const dev = { IDENTITY_PROVIDER: 'demo', DEMO_MODE: 'true', PAYMENT_GATEWAY: 'fake' } as const;

  it('★ recusa PAGAMENTO_MANUAL_WHATSAPP=true sem número (o cliente cairia num link quebrado)', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...dev, PAGAMENTO_MANUAL_WHATSAPP: 'true' }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa número curto demais para ser E.164 com DDI (ex.: esqueceram o 55)', () => {
    expect(() =>
      assertConfiguracaoSegura({
        ...dev,
        PAGAMENTO_MANUAL_WHATSAPP: 'true',
        PAGAMENTO_MANUAL_WHATSAPP_NUMERO: '11990036469',
      }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('aceita a flag ligada com número completo, mesmo com máscara', () => {
    expect(() =>
      assertConfiguracaoSegura({
        ...dev,
        PAGAMENTO_MANUAL_WHATSAPP: 'true',
        PAGAMENTO_MANUAL_WHATSAPP_NUMERO: '+55 (11) 99003-6469',
      }),
    ).not.toThrow();
  });

  it('flag desligada não exige número nenhum (é o estado normal do sistema)', () => {
    expect(() => assertConfiguracaoSegura({ ...dev })).not.toThrow();
    expect(() =>
      assertConfiguracaoSegura({ ...dev, PAGAMENTO_MANUAL_WHATSAPP: 'false' }),
    ).not.toThrow();
  });

  // ── Mercado Pago (Orders API, 2026-08-26) ────────────────────────────────
  const mp = {
    IDENTITY_PROVIDER: 'demo',
    DEMO_MODE: 'true',
    PAYMENT_GATEWAY: 'mercadopago',
    MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-access',
    MERCADOPAGO_WEBHOOK_SECRET: 'segredo-do-painel',
    MERCADOPAGO_ENV: 'staging',
  } as const;

  it('recusa PAYMENT_GATEWAY=mercadopago sem MERCADOPAGO_ACCESS_TOKEN', () => {
    const { MERCADOPAGO_ACCESS_TOKEN: _, ...semToken } = mp;
    expect(() => assertConfiguracaoSegura({ ...semToken })).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa mercadopago sem MERCADOPAGO_WEBHOOK_SECRET (webhook exposto sem validação)', () => {
    const { MERCADOPAGO_WEBHOOK_SECRET: _, ...semSecret } = mp;
    expect(() => assertConfiguracaoSegura({ ...semSecret })).toThrow(ConfiguracaoInseguraError);
  });

  it('★ recusa mercadopago sem MERCADOPAGO_ENV — o ambiente NÃO é inferível', () => {
    // Teste e produção usam ambos tokens APP_USR- e o mesmo host: sem esta env
    // não há como recusar uma notificação com live_mode divergente.
    const { MERCADOPAGO_ENV: _, ...semAmbiente } = mp;
    expect(() => assertConfiguracaoSegura({ ...semAmbiente })).toThrow(ConfiguracaoInseguraError);
  });

  it('recusa MERCADOPAGO_ENV com valor desconhecido (fail closed, nunca cai num default)', () => {
    expect(() => assertConfiguracaoSegura({ ...mp, MERCADOPAGO_ENV: 'homolog' })).toThrow(
      ConfiguracaoInseguraError,
    );
  });

  it('★ recusa MERCADOPAGO_PUBLIC_KEY idêntica ao ACCESS_TOKEN (publicaria o token no bundle)', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...mp, MERCADOPAGO_PUBLIC_KEY: mp.MERCADOPAGO_ACCESS_TOKEN }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  // ── Placeholder do .env.example (2026-08-27) ─────────────────────────────
  //
  // Nasceu de um bug real: o `.env` foi copiado do exemplo, a chave pública e os
  // ids foram preenchidos, e o Access Token ficou em `APP_USR-0000…`. A API subiu
  // saudável — todas as variáveis estavam PRESENTES — e a falha só apareceu no
  // primeiro checkout de cartão, como HTTP 401 num log de servidor, com o cliente
  // olhando um erro genérico.
  //
  // Os valores abaixo são os placeholders LITERAIS do `.env.example`, copiados à
  // mão. Se alguém trocar a forma dos placeholders lá sem ajustar a heurística
  // aqui, é este teste que precisa quebrar.
  const PLACEHOLDER_TOKEN = 'APP_USR-0000000000000000-000000-00000000000000000000000000000000-0000000000';
  const PLACEHOLDER_SECRET = '0'.repeat(64);

  it('★ recusa MERCADOPAGO_ACCESS_TOKEN ainda com o placeholder (presente ≠ preenchido)', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...mp, MERCADOPAGO_ACCESS_TOKEN: PLACEHOLDER_TOKEN }),
    ).toThrow(/MERCADOPAGO_ACCESS_TOKEN.*valor de exemplo/s);
  });

  it('★ recusa MERCADOPAGO_WEBHOOK_SECRET ainda com o placeholder', () => {
    expect(() =>
      assertConfiguracaoSegura({ ...mp, MERCADOPAGO_WEBHOOK_SECRET: PLACEHOLDER_SECRET }),
    ).toThrow(/MERCADOPAGO_WEBHOOK_SECRET.*valor de exemplo/s);
  });

  it('a mesma trava vale para a AbacatePay', () => {
    const base = {
      IDENTITY_PROVIDER: 'demo',
      DEMO_MODE: 'true',
      PAYMENT_GATEWAY: 'abacatepay',
      ABACATEPAY_API_KEY: 'abc_dev_real',
      ABACATEPAY_WEBHOOK_SECRET: 'segredo-real',
      ABACATEPAY_TAXA_BASIS_POINTS: '299',
    };
    expect(() => assertConfiguracaoSegura(base)).not.toThrow();
    expect(() =>
      assertConfiguracaoSegura({ ...base, ABACATEPAY_API_KEY: '0'.repeat(32) }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('a mensagem diz ONDE achar o valor certo — endereço, não só diagnóstico', () => {
    // Uma mensagem que só afirma "configuração inválida" move a depuração de
    // lugar em vez de encerrá-la. Este teste é sobre a mensagem, de propósito.
    expect(() =>
      assertConfiguracaoSegura({ ...mp, MERCADOPAGO_ACCESS_TOKEN: PLACEHOLDER_TOKEN }),
    ).toThrow(/Suas integrações.*Credenciais/s);
  });

  it('não é falso positivo: credencial com a FORMA da real, e zeros esparsos, passa', () => {
    // ★ Valor SINTÉTICO, com a forma de um token real mas nenhum dígito de uma
    // credencial de verdade. Um token real num arquivo versionado seria o mesmo
    // vazamento que este gate existe para evitar.
    //
    // O ponto do teste: tokens reais TÊM zeros — no carimbo de data, no id da
    // aplicação, no id do vendedor. A heurística exige uma corrida de 8+ zeros
    // seguidos, que entropia de hex real não produz, então zeros esparsos passam.
    expect(() =>
      assertConfiguracaoSegura({
        ...mp,
        MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-1902374650182937-010203-9f0a3b0c7d0e1f0a2b0c3d0e4f0a5b0c-4071820394',
        MERCADOPAGO_WEBHOOK_SECRET: 'a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0c0d0e0f0a0b0',
      }),
    ).not.toThrow();
  });

  it('aceita mercadopago com token, secret e ambiente — com e sem chave pública', () => {
    expect(() => assertConfiguracaoSegura({ ...mp })).not.toThrow();
    expect(() =>
      assertConfiguracaoSegura({ ...mp, MERCADOPAGO_PUBLIC_KEY: 'APP_USR-public' }),
    ).not.toThrow();
  });

  it('aceita mercadopago em produção (mesmo código, só muda o valor da env)', () => {
    expect(() =>
      assertConfiguracaoSegura({
        ...mp,
        NODE_ENV: 'production',
        IDENTITY_PROVIDER: 'whatsapp',
        DEMO_MODE: 'false',
        MERCADOPAGO_ENV: 'producao',
        // Fase 8: rede para o cálculo do líquido; obrigatória só em produção.
        MERCADOPAGO_TAXA_BASIS_POINTS: '499',
      }),
    ).not.toThrow();
  });

  it('★ recusa mercadopago junto com PAGAMENTO_MANUAL_WHATSAPP=true — uma ou outra', () => {
    // O modo manual desliga a cobrança online: o gateway ficaria configurado e
    // nunca seria chamado, e isso só apareceria no primeiro cliente sem cobrança.
    expect(() =>
      assertConfiguracaoSegura({
        ...mp,
        PAGAMENTO_MANUAL_WHATSAPP: 'true',
        PAGAMENTO_MANUAL_WHATSAPP_NUMERO: '5511990036469',
      }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  it('a exclusão é só do mercadopago: manual + abacatepay continua subindo (não-regressão)', () => {
    expect(() =>
      assertConfiguracaoSegura({
        IDENTITY_PROVIDER: 'demo',
        DEMO_MODE: 'true',
        PAYMENT_GATEWAY: 'abacatepay',
        ABACATEPAY_API_KEY: 'k',
        ABACATEPAY_WEBHOOK_SECRET: 's',
        ABACATEPAY_TAXA_BASIS_POINTS: '299',
        PAGAMENTO_MANUAL_WHATSAPP: 'true',
        PAGAMENTO_MANUAL_WHATSAPP_NUMERO: '5511990036469',
      }),
    ).not.toThrow();
  });

  it('mercadopago não interfere no abacatepay: credencial de um não satisfaz o outro', () => {
    expect(() =>
      assertConfiguracaoSegura({
        IDENTITY_PROVIDER: 'demo',
        DEMO_MODE: 'true',
        PAYMENT_GATEWAY: 'abacatepay',
        MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-access',
        MERCADOPAGO_WEBHOOK_SECRET: 's',
        MERCADOPAGO_ENV: 'staging',
      }),
    ).toThrow(ConfiguracaoInseguraError);
  });

  // ── Fase 8 (2026-08-27): comissão sobre o LÍQUIDO ────────────────────────────
  //
  // Este gate substitui a instrução original do plano de "adiar o lançamento
  // quando o líquido não for conhecido". Adiar deixaria a comissão do barbeiro sem
  // existir, sem erro e sem tela que a liberasse — ver `comissao-liquida.ts`.
  // Eliminar a incerteza no BOOT é o que permite nunca chegar lá.

  it('★ recusa abacatepay SEM a taxa — é a única fonte de líquido que ela tem', () => {
    expect(() =>
      assertConfiguracaoSegura({
        IDENTITY_PROVIDER: 'demo',
        DEMO_MODE: 'true',
        PAYMENT_GATEWAY: 'abacatepay',
        ABACATEPAY_API_KEY: 'k',
        ABACATEPAY_WEBHOOK_SECRET: 's',
      }),
    ).toThrow(/ABACATEPAY_TAXA_BASIS_POINTS/);
  });

  it('★ taxa ZERO é aceita — "a casa banca a taxa" é uma decisão, vazio não é', () => {
    // A distinção é o ponto do gate: 0 significa alguém decidiu; ausente significa
    // ninguém decidiu, e um ledger de comissão imutável não perdoa isso.
    expect(() =>
      assertConfiguracaoSegura({
        IDENTITY_PROVIDER: 'demo',
        DEMO_MODE: 'true',
        PAYMENT_GATEWAY: 'abacatepay',
        ABACATEPAY_API_KEY: 'k',
        ABACATEPAY_WEBHOOK_SECRET: 's',
        ABACATEPAY_TAXA_BASIS_POINTS: '0',
      }),
    ).not.toThrow();
  });

  it('★ taxa com VÍRGULA é recusada — "2.99" no lugar de "299" erraria toda comissão', () => {
    // `'299.0'` NÃO está aqui: é 299 pontos-base escrito de forma redundante, e o
    // valor está certo. O que precisa morrer é a confusão de UNIDADE — 2.99 (que
    // seria 0,0299%) e 99999 (que seria 999%) —, não a grafia.
    for (const invalida of ['2.99', '2,99', 'abc', '-1', '99999', '3001']) {
      expect(
        () =>
          assertConfiguracaoSegura({
            IDENTITY_PROVIDER: 'demo',
            DEMO_MODE: 'true',
            PAYMENT_GATEWAY: 'abacatepay',
            ABACATEPAY_API_KEY: 'k',
            ABACATEPAY_WEBHOOK_SECRET: 's',
            ABACATEPAY_TAXA_BASIS_POINTS: invalida,
          }),
        invalida,
      ).toThrow(/pontos-base/);
    }
  });

  it('299.0 é aceito — mesma unidade, grafia redundante', () => {
    expect(() =>
      assertConfiguracaoSegura({
        IDENTITY_PROVIDER: 'demo',
        DEMO_MODE: 'true',
        PAYMENT_GATEWAY: 'abacatepay',
        ABACATEPAY_API_KEY: 'k',
        ABACATEPAY_WEBHOOK_SECRET: 's',
        ABACATEPAY_TAXA_BASIS_POINTS: '299.0',
      }),
    ).not.toThrow();
  });

  it('mercadopago em DEV não exige a taxa — o líquido vem da própria order', () => {
    expect(() =>
      assertConfiguracaoSegura({
        IDENTITY_PROVIDER: 'demo',
        DEMO_MODE: 'true',
        PAYMENT_GATEWAY: 'mercadopago',
        MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-access',
        MERCADOPAGO_WEBHOOK_SECRET: 's',
        MERCADOPAGO_ENV: 'staging',
      }),
    ).not.toThrow();
  });

  it('★ mercadopago em PRODUÇÃO exige a taxa como rede', () => {
    expect(() =>
      assertConfiguracaoSegura({
        NODE_ENV: 'production',
        IDENTITY_PROVIDER: 'whatsapp',
        DEMO_MODE: 'false',
        PAYMENT_GATEWAY: 'mercadopago',
        MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-access',
        MERCADOPAGO_WEBHOOK_SECRET: 's',
        MERCADOPAGO_ENV: 'producao',
      }),
    ).toThrow(/MERCADOPAGO_TAXA_BASIS_POINTS/);
  });

  it('gateway fake não exige taxa nenhuma (não cobra, não retém)', () => {
    expect(() =>
      assertConfiguracaoSegura({ IDENTITY_PROVIDER: 'demo', DEMO_MODE: 'true', PAYMENT_GATEWAY: 'fake' }),
    ).not.toThrow();
  });
});
