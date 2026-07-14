import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { WebhookAbacatePayRequest } from '@bigods/contracts';
import { ProcessarWebhookUseCase } from '../application/processar-webhook.usecase';
import { Publico } from '../../identity/presentation/auth.decorators';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly processar: ProcessarWebhookUseCase) {}

  /**
   * Webhook do AbacatePay. Público por natureza; idempotente por obrigação —
   * gateways reenviam o mesmo evento.
   */
  @Publico()
  @Post('abacatepay')
  async abacatepay(@Body() body: WebhookAbacatePayRequest): Promise<{ processado: boolean }> {
    const externalId = body?.data?.metadata?.externalId;
    if (!externalId) {
      throw new BadRequestException('Payload sem data.metadata.externalId');
    }
    if (body.event !== 'billing.paid') {
      return { processado: false };
    }
    return this.processar.executar({ externalId });
  }
}
