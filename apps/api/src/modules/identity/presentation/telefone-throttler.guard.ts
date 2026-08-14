import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Telefone } from '../../../shared/domain/telefone';

/**
 * Chave (tracker) do rate limiter global: o TELEFONE quando presente no corpo
 * da requisição, senão o IP. Assim os endpoints de login por OTP contam por
 * telefone (freia força bruta de código e martelar o mesmo número),
 * independentemente do IP; os demais endpoints contam por IP.
 *
 * Este limite por telefone NÃO cobre sozinho o cenário de spam: quem varre mil
 * números diferentes ganha mil baldes distintos. Essa trava é o throttler
 * `otp-origem` (ver `app.module.ts`), que conta por origem e usa
 * `trackerPorOrigem` daqui.
 *
 * Os limites por rota vêm de `@Throttle(...)`; este guard só decide a chave.
 */
@Injectable()
export class TelefoneOuIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const telefoneBruto = req.body?.telefone ?? req.query?.telefone;
    if (typeof telefoneBruto === 'string' && telefoneBruto.trim()) {
      return `tel:${normalizarTelefone(telefoneBruto)}`;
    }
    return trackerPorOrigem(req);
  }
}

/**
 * Normaliza para a MESMA forma que o domínio grava (E.164). Sem isto,
 * "11999998888", "(11) 99999-8888" e "+5511999998888" viravam três baldes
 * diferentes para o mesmo número — bastava alternar o formato a cada chamada
 * para multiplicar o limite por telefone.
 *
 * Entrada que não normaliza (número inválido) cai nos dígitos crus: continua
 * limitada, e a validação de verdade acontece no caso de uso.
 */
function normalizarTelefone(bruto: string): string {
  try {
    return Telefone.de(bruto).e164;
  } catch {
    return bruto.replace(/\D/g, '');
  }
}

/**
 * Origem da requisição. Depende de `trust proxy` estar ligado (ver `main.ts`):
 * em produção a API só é alcançada pelo Caddy, que sobrescreve o
 * `X-Forwarded-For` com o peer real.
 */
export function trackerPorOrigem(req: Record<string, any>): string {
  const ip = req.ips?.length ? req.ips[0] : req.ip;
  return `ip:${ip}`;
}
