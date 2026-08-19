import { Logger, Module } from '@nestjs/common';
import { WebhooksController } from './presentation/webhooks.controller';
import { AbacatePayWebhookGuard } from './presentation/abacatepay-webhook.guard';
import { ProcessarWebhookUseCase } from './application/processar-webhook.usecase';
import { ExpirarPagamentoVencidoUseCase } from './application/expirar-pagamento-vencido.usecase';
import { PAYMENT_GATEWAY, PaymentGateway } from './domain/payment-gateway';
import { FakeAbacatePayGateway } from './infrastructure/fake-abacatepay.gateway';
import { AbacatePayGateway } from './infrastructure/abacatepay.gateway';
import { CobrancaOnlineService } from './application/cobranca-online.service';
import {
  CONFIG_PAGAMENTO_MANUAL,
  lerConfigPagamentoManual,
} from '../../shared/config/pagamento-manual';
import { PagamentoStatusQueryService } from './infrastructure/pagamento-status-query.service';

const EXPIRA_PADRAO_SEGUNDOS = 3600;

/**
 * Adapter ativo por variável de ambiente (mesmo padrão do IdentityProvider).
 * Default: `abacatepay` em produção, `fake` em dev/test. Esta factory é o ÚNICO
 * ponto que conhece os dois adapters — trocar fake↔abacatepay é só a env, zero
 * mudança de domínio/aplicação.
 */
export function gatewayAtivo(): 'abacatepay' | 'fake' {
  const padrao = process.env.NODE_ENV === 'production' ? 'abacatepay' : 'fake';
  return (process.env.PAYMENT_GATEWAY ?? padrao).toLowerCase() === 'abacatepay' ? 'abacatepay' : 'fake';
}

function criarPaymentGateway(): PaymentGateway {
  if (gatewayAtivo() === 'abacatepay') {
    Logger.log('PaymentGateway: AbacatePay (real)', 'PaymentsModule');
    return new AbacatePayGateway({
      apiKey: exigir('ABACATEPAY_API_KEY'),
      // Checkout Transparente vive em /v2 (§ AbacatePayGateway) — v1 não tem
      // /transparents/* e emitiria eventos que não estão assinados nesta conta.
      baseUrl: process.env.ABACATEPAY_BASE_URL ?? 'https://api.abacatepay.com/v2',
      expiraEmSegundos: Number(process.env.ABACATEPAY_EXPIRA_SEGUNDOS ?? '') || EXPIRA_PADRAO_SEGUNDOS,
    });
  }
  Logger.log('PaymentGateway: Fake (sem webhook exposto)', 'PaymentsModule');
  return new FakeAbacatePayGateway();
}

function exigir(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} é obrigatória com PAYMENT_GATEWAY=abacatepay`);
  }
  return valor;
}

// O webhook real só é montado com o gateway real. Com o fake, NENHUMA superfície
// de webhook é exposta (o brief: "o fake não expõe webhook nenhum").
const controllers = gatewayAtivo() === 'abacatepay' ? [WebhooksController] : [];

@Module({
  controllers,
  providers: [
    ProcessarWebhookUseCase,
    ExpirarPagamentoVencidoUseCase,
    AbacatePayWebhookGuard,
    PagamentoStatusQueryService,
    CobrancaOnlineService,
    { provide: PAYMENT_GATEWAY, useFactory: criarPaymentGateway },
    // Modo manual (TEMPORÁRIO): lido uma vez no boot — a flag não muda em
    // runtime, e assim o ponto de decisão recebe config, não `process.env`.
    { provide: CONFIG_PAGAMENTO_MANUAL, useFactory: () => lerConfigPagamentoManual() },
  ],
  exports: [
    PAYMENT_GATEWAY,
    PagamentoStatusQueryService,
    ProcessarWebhookUseCase,
    ExpirarPagamentoVencidoUseCase,
    CobrancaOnlineService,
    CONFIG_PAGAMENTO_MANUAL,
  ],
})
export class PaymentsModule {}
