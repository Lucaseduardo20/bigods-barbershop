import { Body, Controller, Logger, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WebhookMercadoPagoRequest } from '@bigods/contracts';
import { ProcessarWebhookMercadoPagoUseCase } from '../application/processar-webhook-mercadopago.usecase';
import { Publico } from '../../identity/presentation/auth.decorators';
import { MercadoPagoWebhookGuard } from './mercadopago-webhook.guard';

/**
 * Webhook do Mercado Pago (tópico `order`).
 *
 * A assinatura é validada pelo `MercadoPagoWebhookGuard` ANTES de qualquer
 * processamento; payload não-verificado nunca chega aqui.
 *
 * ## A regra de códigos de resposta, que é veneno se copiada errada
 *
 * O controller da AbacatePay lança `BadRequestException` quando falta
 * `externalId`, e o `ProcessarWebhookUseCase` lança `NotFoundException` quando a
 * intenção não existe. **Copiar isso aqui seria um bug grave**: o Mercado Pago
 * retenta a cada 15 minutos até receber 2xx, e nunca para. Um 404 por order
 * desconhecida viraria retentativa eterna.
 *
 * Então:
 *
 * - assinatura inválida ⇒ **401** (o guard). Queremos que pare e apareça no log.
 * - assinatura válida + QUALQUER desfecho de negócio (order desconhecida, valor
 *   divergente, status que não mapeamos, notificação de outro ambiente) ⇒
 *   **200**, com o desfecho no corpo e no log.
 * - falha de infraestrutura nossa ou do `GET` ⇒ **5xx**, deixando o retry do
 *   Mercado Pago ser a nossa fila. É por isso que o caso de uso PROPAGA erro de
 *   rede em vez de engolir.
 *
 * O Mercado Pago espera a resposta em até **22 segundos**.
 */
@Controller('webhooks')
export class MercadoPagoWebhookController {
  private readonly logger = new Logger(MercadoPagoWebhookController.name);

  constructor(private readonly processar: ProcessarWebhookMercadoPagoUseCase) {}

  @Publico()
  @UseGuards(MercadoPagoWebhookGuard)
  // Mesmo validado por assinatura, limitamos replay/payload malformado.
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('mercadopago')
  async mercadopago(
    @Body() body: WebhookMercadoPagoRequest,
    @Query() query: Record<string, string | undefined>,
  ): Promise<{ processado: boolean; motivo?: string }> {
    // Só o tópico `order` interessa. Qualquer outro é ignorado GRACIOSAMENTE —
    // 200 sem efeito, nunca erro: um 4xx por evento desconhecido faria o Mercado
    // Pago retentar para sempre algo que nunca vamos processar.
    const tipo = body?.type ?? query['type'] ?? '';
    if (tipo !== 'order') {
      this.logger.log(`Notificação de tópico "${tipo}" ignorada (só tratamos "order").`);
      return { processado: false, motivo: `tópico ${tipo} não tratado` };
    }

    // ★ O id vem do QUERY PARAM, com chave literal contendo ponto. É a versão que
    // o manifesto da assinatura cobre — usar a do corpo seria confiar num campo
    // não assinado. O corpo é fallback apenas.
    const idDoQuery = query['data.id'];
    const idDoCorpo = body?.data?.id;
    if (idDoQuery && idDoCorpo && idDoQuery !== idDoCorpo) {
      // Não recusamos: a assinatura já garantiu a origem, e o id assinado é o do
      // query. Mas divergir aqui é anômalo o suficiente para registrar.
      this.logger.warn(
        `data.id divergente entre query (${idDoQuery}) e corpo (${idDoCorpo}) — usando o do query, que é o assinado.`,
      );
    }
    const orderId = idDoQuery ?? idDoCorpo;
    if (!orderId) {
      this.logger.warn('Notificação de order sem data.id — nada a consultar.');
      return { processado: false, motivo: 'notificação sem data.id' };
    }

    return this.processar.executar({
      orderId,
      ...(body?.application_id === undefined
        ? {}
        : { applicationId: String(body.application_id) }),
      ...(body?.user_id === undefined ? {} : { userId: String(body.user_id) }),
      ...(body?.live_mode === undefined ? {} : { liveMode: body.live_mode }),
    });
  }
}
