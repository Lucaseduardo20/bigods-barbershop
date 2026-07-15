import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Payload da sessão do cliente final (área logada). Separado da sessão de staff. */
export interface ClienteAutenticado {
  clienteId: string;
  companyId: string;
  sub: string;
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — cliente final loga raramente

/**
 * Emite/valida o token de sessão do CLIENTE após o login OTP. Token próprio da
 * aplicação (HMAC), provider-agnóstico: vale igual com demo ou Cognito, porque
 * o guard valida ESTE token, não o JWT do Cognito. É o que garante "trocar
 * demo→produção é só variável de ambiente" na camada de autorização.
 */
@Injectable()
export class ClienteSessaoService {
  private readonly secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

  emitir(cliente: ClienteAutenticado): string {
    const payload = Buffer.from(JSON.stringify({ ...cliente, exp: Date.now() + TTL_MS })).toString(
      'base64url',
    );
    return `${payload}.${this.assinar(payload)}`;
  }

  verificar(token: string): ClienteAutenticado | null {
    const [payload, assinatura] = token.split('.');
    if (!payload || !assinatura) return null;
    const esperada = this.assinar(payload);
    const a = Buffer.from(assinatura);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (typeof dados.exp !== 'number' || dados.exp < Date.now()) return null;
      return { clienteId: dados.clienteId, companyId: dados.companyId, sub: dados.sub };
    } catch {
      return null;
    }
  }

  private assinar(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
