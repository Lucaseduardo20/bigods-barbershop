import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiter global. A chave (tracker) é o TELEFONE quando presente no corpo
 * da requisição — senão o IP. Assim o limite dos endpoints de login por OTP conta
 * por telefone (freia força bruta de código e esgotamento de custo de SMS),
 * independentemente do IP; os demais endpoints continuam limitados por IP.
 *
 * Os limites por rota vêm de `@Throttle(...)`; este guard só decide a chave.
 */
@Injectable()
export class TelefoneOuIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const telefoneBruto = req.body?.telefone ?? req.query?.telefone;
    if (typeof telefoneBruto === 'string' && telefoneBruto.trim()) {
      // Normaliza para dígitos: "(11) 99999-8888" e "11999998888" contam igual.
      const digitos = telefoneBruto.replace(/\D/g, '');
      if (digitos.length >= 8) return `tel:${digitos}`;
    }
    const ip = req.ips?.length ? req.ips[0] : req.ip;
    return `ip:${ip}`;
  }
}
