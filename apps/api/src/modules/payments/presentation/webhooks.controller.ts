import { BadRequestException, Body, Controller, Logger, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WebhookAbacatePayRequest } from '@bigods/contracts';
import { ProcessarWebhookUseCase } from '../application/processar-webhook.usecase';
import { Publico } from '../../identity/presentation/auth.decorators';
import { AbacatePayWebhookGuard } from './abacatepay-webhook.guard';

/**
 * Eventos assinados nesta conta (Checkout Transparente, dashboard AbacatePay):
 * `transparent.completed` e `transparent.lost`. Qualquer outro evento que
 * eventualmente chegue (não deveria, mas a AbacatePay pode reenviar por engano
 * ou a conta pode ganhar novas assinaturas no futuro) é ignorado graciosamente
 * — 200 OK, sem efeito, sem erro (nunca 4xx/5xx por evento desconhecido, senão
 * a AbacatePay fica retentando pra sempre).
 */
const EVENTO_CONFIRMADO = 'transparent.completed';
const EVENTO_DISPUTA_PERDIDA = 'transparent.lost';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly processar: ProcessarWebhookUseCase) {}

  /**
   * Webhook do AbacatePay. A assinatura é validada pelo AbacatePayWebhookGuard
   * ANTES de qualquer processamento; payload não-verificado nunca chega aqui.
   * Idempotente por obrigação — gateways reenviam o mesmo evento (§3.8).
   *
   * Não validamos o payload inteiro contra um schema rígido (a própria
   * AbacatePay recomenda isso p/ não quebrar com mudanças deles): extraímos
   * só o que usamos.
   */
  @Publico()
  @UseGuards(AbacatePayWebhookGuard)
  // Mesmo validado por assinatura, limitamos replay/payload malformado.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('abacatepay')
  async abacatepay(@Body() body: WebhookAbacatePayRequest): Promise<{ processado: boolean }> {
    const evento = body?.event ?? '';

    if (evento === EVENTO_DISPUTA_PERDIDA) {
      // ★ DECISAO_PENDENTE (ver DECISOES_PENDENTES.md): `transparent.lost` é uma
      // disputa/chargeback que JÁ estava PAGA e foi perdida — não "PIX expirou".
      // Reverter o pagamento (estornar comissão liberada, revogar crédito de
      // pacote já consumido) é uma decisão financeira que não foi pedida nesta
      // sessão. Registramos e NÃO tocamos em nenhuma entidade — o mínimo que
      // não bloqueia, sem inventar a regra de estorno.
      const externalId = extrairExternalId(body);
      this.logger.warn(`transparent.lost (disputa perdida) recebido — externalId=${externalId ?? '?'}. Nenhuma ação automática; revisar manualmente.`);
      return { processado: false };
    }

    if (evento !== EVENTO_CONFIRMADO) {
      return { processado: false };
    }

    const externalId = extrairExternalId(body);
    if (!externalId) {
      throw new BadRequestException('Payload sem externalId');
    }
    return this.processar.executar({ externalId });
  }
}

/**
 * v2 Checkout Transparente: `data.transparent.externalId`. Fallbacks abaixo são
 * só defensivos (formato v2 real nunca usa esses caminhos para `transparent.*`).
 */
function extrairExternalId(body: WebhookAbacatePayRequest): string | undefined {
  const data = (body?.data ?? {}) as Record<string, any>;
  return (
    data?.transparent?.externalId ??
    data?.metadata?.externalId ??
    data?.externalId ??
    undefined
  );
}
