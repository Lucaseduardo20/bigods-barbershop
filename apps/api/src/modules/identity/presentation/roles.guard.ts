import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Papel } from '@bigods/contracts';
import { AUTH_PROVIDER, AuthProvider } from '../domain/auth-provider';
import { PAPEIS_KEY, PUBLICO_KEY } from './auth.decorators';

/**
 * Autorização centralizada (guard global): toda rota exige autenticação,
 * exceto as marcadas @Publico(). Papel é enum — nunca string comparada inline.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(PUBLICO_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const [esquema, token] = (req.headers.authorization ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token ausente');
    }
    const usuario = this.auth.verificarToken(token);
    if (!usuario) {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
    req.usuario = usuario;

    const papeisRequeridos = this.reflector.getAllAndOverride<Papel[]>(PAPEIS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (papeisRequeridos && !papeisRequeridos.some((p) => usuario.papeis.includes(p))) {
      throw new ForbiddenException('Papel insuficiente');
    }
    return true;
  }
}
