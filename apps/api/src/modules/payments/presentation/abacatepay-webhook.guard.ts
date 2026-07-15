import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { verificarWebhookAbacatePay } from '../infrastructure/abacatepay-webhook.verifier';

/**
 * Guard que valida a assinatura HMAC-SHA256 do webhook do AbacatePay ANTES de
 * qualquer processamento. Payload não-verificado é rejeitado com 401 sem tocar
 * em nenhuma entidade de domínio.
 *
 * INCONDICIONAL: roda sempre que o endpoint real está exposto, em qualquer
 * ambiente. Não existe branch de "pular validação em dev/demo" — quem não quer
 * expor o webhook usa o FakeAbacatePayGateway (que nem monta este controller).
 */
@Injectable()
export class AbacatePayWebhookGuard implements CanActivate {
  private readonly logger = new Logger(AbacatePayWebhookGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      rawBody?: Buffer;
      headers: Record<string, string | string[] | undefined>;
      query: Record<string, unknown>;
    }>();

    const segredo = process.env.ABACATEPAY_WEBHOOK_SECRET ?? '';
    // HMAC precisa dos bytes CRUS; se o rawBody não veio, falha fechada.
    const corpoCru = req.rawBody;
    if (!corpoCru) {
      this.logger.error('Webhook sem rawBody — habilite rawBody no bootstrap.');
      throw new UnauthorizedException('Assinatura ausente');
    }

    const header = req.headers['x-webhook-signature'];
    const assinaturaHeader = Array.isArray(header) ? header[0] : header;
    const segredoQuery = typeof req.query.webhookSecret === 'string' ? req.query.webhookSecret : undefined;

    const valido = verificarWebhookAbacatePay({ corpoCru, assinaturaHeader, segredoQuery, segredo });
    if (!valido) {
      this.logger.warn('Webhook do AbacatePay com assinatura inválida — rejeitado (401).');
      throw new UnauthorizedException('Assinatura inválida');
    }
    return true;
  }
}
