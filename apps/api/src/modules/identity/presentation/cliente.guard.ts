import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ClienteAutenticado,
  ClienteSessaoService,
} from '../infrastructure/cliente-sessao.service';
import { Publico } from './auth.decorators';

/**
 * Autentica o CLIENTE final (área logada) via o token de sessão próprio da
 * aplicação. Separado do `RolesGuard` de staff — são audiências diferentes.
 */
@Injectable()
export class ClienteGuard implements CanActivate {
  constructor(private readonly sessao: ClienteSessaoService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const [esquema, token] = (req.headers.authorization ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token de cliente ausente');
    }
    const cliente = this.sessao.verificar(token);
    if (!cliente) {
      throw new UnauthorizedException('Token de cliente inválido ou expirado');
    }
    req.clienteAtual = cliente;
    return true;
  }
}

/**
 * Rota da área logada do cliente: dispensa o guard de staff (@Publico) e exige
 * o token de cliente (ClienteGuard). O "público" aqui é só em relação ao staff.
 */
export function ContaCliente() {
  return applyDecorators(Publico(), UseGuards(ClienteGuard));
}

export const ClienteAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ClienteAutenticado => {
    return ctx.switchToHttp().getRequest().clienteAtual;
  },
);
