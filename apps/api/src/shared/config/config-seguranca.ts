/**
 * Validação de configuração que DEVE impedir a aplicação de subir se estiver
 * insegura. Pura (recebe um mapa de env) para ser testável sem processo.
 */

export class ConfiguracaoInseguraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfiguracaoInseguraError';
  }
}

/**
 * `DEMO_MODE=true` faz a API devolver o código OTP na resposta (sem SMS) — é
 * ótimo em dev e **catastrófico** em produção (qualquer um loga como qualquer
 * telefone). Recusar subir com `DEMO_MODE=true` e `NODE_ENV=production` juntos
 * é a rede de segurança para isso nunca vazar por acidente.
 */
export function assertConfiguracaoSegura(env: NodeJS.ProcessEnv = process.env): void {
  const demoMode = env.DEMO_MODE === 'true';
  const producao = env.NODE_ENV === 'production';

  if (demoMode && producao) {
    throw new ConfiguracaoInseguraError(
      'DEMO_MODE=true não pode rodar com NODE_ENV=production — o código OTP vazaria na resposta da API. ' +
        'Use IDENTITY_PROVIDER=cognito e DEMO_MODE ausente/false em produção.',
    );
  }

  // Em produção com o provider demo, o login não teria SMS real — sinal de
  // configuração errada. Não bloqueia o boot, mas é um erro de operação.
  if (producao && (env.IDENTITY_PROVIDER ?? 'demo') === 'demo') {
    throw new ConfiguracaoInseguraError(
      'IDENTITY_PROVIDER=demo em produção não envia SMS real. Configure IDENTITY_PROVIDER=cognito.',
    );
  }

  // Com o gateway real ativo, o webhook fica exposto e sua validação de
  // assinatura é INCONDICIONAL — logo, a API key e o webhook secret têm de
  // existir em QUALQUER ambiente (dev com túnel, homologação, produção).
  // Sem o secret, o webhook não teria como validar a origem — falha fechada.
  const gatewayPadrao = producao ? 'abacatepay' : 'fake';
  const gateway = (env.PAYMENT_GATEWAY ?? gatewayPadrao).toLowerCase();
  if (gateway === 'abacatepay') {
    if (!env.ABACATEPAY_API_KEY) {
      throw new ConfiguracaoInseguraError(
        'PAYMENT_GATEWAY=abacatepay exige ABACATEPAY_API_KEY. Use PAYMENT_GATEWAY=fake para demo sem gateway real.',
      );
    }
    if (!env.ABACATEPAY_WEBHOOK_SECRET) {
      throw new ConfiguracaoInseguraError(
        'PAYMENT_GATEWAY=abacatepay expõe o webhook e exige ABACATEPAY_WEBHOOK_SECRET para validar a assinatura. ' +
          'Sem ele, qualquer um forjaria confirmação de pagamento. Use PAYMENT_GATEWAY=fake se não quiser expor o webhook.',
      );
    }
  }
}
