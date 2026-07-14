import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Papel } from '@bigods/contracts';
import { UsuarioAutenticado } from '../domain/auth-provider';

export const PAPEIS_KEY = 'papeis_requeridos';
export const PUBLICO_KEY = 'rota_publica';

/** Papéis autorizados na rota. Sem decorator = qualquer autenticado. */
export const Papeis = (...papeis: Papel[]) => SetMetadata(PAPEIS_KEY, papeis);

/** Rota sem autenticação (login, webhook). Uso consciente e raro. */
export const Publico = () => SetMetadata(PUBLICO_KEY, true);

export const UsuarioAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
    return ctx.switchToHttp().getRequest().usuario;
  },
);
