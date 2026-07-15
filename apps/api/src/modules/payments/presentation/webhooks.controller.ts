import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WebhookAbacatePayRequest } from '@bigods/contracts';
import { ProcessarWebhookUseCase } from '../application/processar-webhook.usecase';
import { Publico } from '../../identity/presentation/auth.decorators';
import { AbacatePayWebhookGuard } from './abacatepay-webhook.guard';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly processar: ProcessarWebhookUseCase) {}

  /**
   * Webhook do AbacatePay. A assinatura é validada pelo AbacatePayWebhookGuard
   * ANTES de qualquer processamento; payload não-verificado nunca chega aqui.
   * Idempotente por obrigação — gateways reenviam o mesmo evento (§3.8).
   *
   * Não validamos o payload contra um schema rígido (a própria AbacatePay
   * recomenda isso p/ não quebrar com mudanças deles): extraímos só o que usamos.
   */
  @Publico()
  @UseGuards(AbacatePayWebhookGuard)
  // Mesmo validado por assinatura, limitamos replay/payload malformado.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('abacatepay')
  async abacatepay(@Body() body: WebhookAbacatePayRequest): Promise<{ processado: boolean }> {
    const externalId = extrairExternalId(body);
    if (!externalId) {
      throw new BadRequestException('Payload sem externalId');
    }
    if (!ehPagamentoConfirmado(body)) {
      return { processado: false };
    }
    return this.processar.executar({ externalId });
  }
}

/** externalId pode vir em metadata direto ou aninhado sob o recurso pago. */
function extrairExternalId(body: WebhookAbacatePayRequest): string | undefined {
  const data = (body?.data ?? {}) as Record<string, any>;
  return (
    data?.metadata?.externalId ??
    data?.pixQrCode?.metadata?.externalId ??
    data?.externalId ??
    undefined
  );
}

/** Confirmado se o evento termina em .paid/.completed OU o status é PAID. */
function ehPagamentoConfirmado(body: WebhookAbacatePayRequest): boolean {
  const evento = (body?.event ?? '').toLowerCase();
  if (/\.(paid|completed)$/.test(evento)) return true;
  const status = (body?.data as Record<string, any>)?.status;
  return typeof status === 'string' && status.toUpperCase() === 'PAID';
}
