/**
 * Validação de configuração que DEVE impedir a aplicação de subir se estiver
 * insegura. Pura (recebe um mapa de env) para ser testável sem processo.
 */
import { lerConfigPagamentoManual } from './pagamento-manual';

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

  // Em produção, só um provider que envia o código de verdade é aceito —
  // lista explícita (fail closed) em vez de só recusar 'demo': qualquer
  // valor desconhecido também não sobe, nunca cai num fallback silencioso.
  // Hoje só 'whatsapp' (Baileys) — o Cognito saiu do fluxo de produção nesta
  // sessão (arquivo/testes continuam existindo, só não é mais uma opção).
  const PROVIDERS_VALIDOS_EM_PRODUCAO = ['whatsapp'];
  const identityProvider = (env.IDENTITY_PROVIDER ?? 'demo').toLowerCase();
  if (producao && !PROVIDERS_VALIDOS_EM_PRODUCAO.includes(identityProvider)) {
    throw new ConfiguracaoInseguraError(
      `IDENTITY_PROVIDER=${identityProvider} não é válido em produção (não envia OTP real). Configure IDENTITY_PROVIDER=whatsapp.`,
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

  // Modo manual (TEMPORÁRIO, 2026-08-18): sem o número da barbearia, o funil
  // mandaria o cliente para um link de WhatsApp quebrado bem no momento de
  // pagar — falha fechada no boot em vez de silenciosamente no checkout.
  const manual = lerConfigPagamentoManual(env);
  if (manual.ativo) {
    // 12 dígitos é o piso de um número brasileiro com DDI (55 + DDD + 8) —
    // pega o erro clássico de esquecer o 55.
    if (manual.whatsappNumero.length < 12) {
      throw new ConfiguracaoInseguraError(
        'PAGAMENTO_MANUAL_WHATSAPP=true exige PAGAMENTO_MANUAL_WHATSAPP_NUMERO em E.164 ' +
          '(ex.: 5511990036469) — é o destino da comanda de pagamento.',
      );
    }
  }
}
