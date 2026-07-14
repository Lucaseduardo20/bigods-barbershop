import { Module } from '@nestjs/common';
import { WebhooksController } from './presentation/webhooks.controller';
import { ProcessarWebhookUseCase } from './application/processar-webhook.usecase';
import { PAYMENT_GATEWAY } from './domain/payment-gateway';
import { FakeAbacatePayGateway } from './infrastructure/fake-abacatepay.gateway';

@Module({
  controllers: [WebhooksController],
  providers: [
    ProcessarWebhookUseCase,
    { provide: PAYMENT_GATEWAY, useClass: FakeAbacatePayGateway },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
