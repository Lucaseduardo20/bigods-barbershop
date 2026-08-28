import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { CONFIG_MERCADO_PAGO, ConfigMercadoPago } from '../../../shared/config/mercadopago';
import { verificarWebhookMercadoPago } from '../infrastructure/mercadopago-webhook.verifier';

/**
 * Valida a assinatura HMAC do webhook do Mercado Pago ANTES de qualquer
 * processamento. Payload não-verificado é rejeitado com 401 sem tocar em nenhuma
 * entidade de domínio.
 *
 * INCONDICIONAL, como o da AbacatePay: roda sempre que o endpoint real está
 * exposto, em qualquer ambiente. Não existe branch de "pular validação em dev".
 * Quem não quer expor o webhook usa `PAYMENT_GATEWAY=fake`, que não monta este
 * controller.
 *
 * ## Diferenças em relação ao guard da AbacatePay
 *
 * - **Não precisa de `rawBody`.** O Mercado Pago não assina o corpo: o HMAC é
 *   sobre um manifesto montado de query param e headers.
 * - **`data.id` vem do QUERY PARAM**, e a chave é literal com ponto:
 *   `req.query['data.id']`. O `qs` do Express não interpreta pontos
 *   (`allowDots` é falso por padrão), então `req.query.data.id` é `undefined`.
 *   Ler do corpo produziria manifesto sem o `id` e **401 em 100% das
 *   notificações** — falha silenciosa, com nenhum pagamento confirmando.
 * - **Sem secret na query string.** Aquele mecanismo é da AbacatePay.
 */
@Injectable()
export class MercadoPagoWebhookGuard implements CanActivate {
  private readonly logger = new Logger(MercadoPagoWebhookGuard.name);

  constructor(@Inject(CONFIG_MERCADO_PAGO) private readonly config: ConfigMercadoPago) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      query: Record<string, unknown>;
    }>();

    const valido = verificarWebhookMercadoPago({
      assinaturaHeader: primeiro(req.headers['x-signature']),
      requestId: primeiro(req.headers['x-request-id']),
      dataId: textoDaQuery(req.query['data.id']),
      segredo: this.config.webhookSecret,
      ...(this.config.toleranciaAssinaturaSegundos === undefined
        ? {}
        : { toleranciaSegundos: this.config.toleranciaAssinaturaSegundos }),
    });

    if (!valido) {
      // Log sem o header nem o segredo: o `x-signature` é dado sensível (e o
      // scrubbing do Sentry já apaga qualquer chave que contenha "signature").
      // O `x-request-id` PODE ir — é o que o suporte do Mercado Pago pede.
      this.logger.warn(
        `Webhook do Mercado Pago com assinatura inválida — rejeitado (401). ` +
          `x-request-id=${primeiro(req.headers['x-request-id']) ?? '?'}`,
      );
      throw new UnauthorizedException('Assinatura inválida');
    }
    return true;
  }
}

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Query param pode chegar como array quando repetido na URL
 * (`?data.id=a&data.id=b`). Pegamos o primeiro em vez de concatenar — assim uma
 * URL manipulada com o parâmetro duplicado não muda o manifesto de forma
 * inesperada; ela simplesmente não vai bater com a assinatura.
 */
function textoDaQuery(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor) && typeof valor[0] === 'string') return valor[0];
  return undefined;
}
