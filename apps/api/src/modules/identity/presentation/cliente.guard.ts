import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ClienteAutenticado,
  ClienteSessaoService,
} from '../infrastructure/cliente-sessao.service';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { Publico } from './auth.decorators';

/**
 * Autentica o CLIENTE final (área logada) via o token de sessão próprio da
 * aplicação. Separado do `RolesGuard` de staff — são audiências diferentes.
 */
@Injectable()
export class ClienteGuard implements CanActivate {
  constructor(
    private readonly sessao: ClienteSessaoService,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [esquema, token] = (req.headers.authorization ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new UnauthorizedException('Token de cliente ausente');
    }
    const sessao = this.sessao.verificar(token);
    if (!sessao) {
      throw new UnauthorizedException('Token de cliente inválido ou expirado');
    }

    // A assinatura do token ser válida não basta: ele aponta para um
    // `clienteId`, e esse registro pode ter sumido depois de emitido (exclusão
    // a pedido do cliente, limpeza do admin, restore de backup). Antes, cada
    // controller descobria isso sozinho e devolvia 404 "Cliente não
    // encontrado" — o que deixava o cliente num beco sem saída: o front
    // considera a sessão válida, nunca refaz o OTP, e todo agendamento falha
    // com uma mensagem que não sugere ação nenhuma.
    //
    // Sessão cujo dono não existe mais é sessão inválida. Devolvendo 401 aqui,
    // o caminho de recuperação que os fronts JÁ têm (limpar a sessão local e
    // pedir o OTP de novo) entra em ação sozinho, em todos os endpoints.
    //
    // Custo: uma leitura por chave primária a cada requisição autenticada de
    // cliente — endpoints de cockpit/funil, volume baixo, e a maioria deles já
    // carregava o Cliente logo em seguida de qualquer forma.
    const cliente = await this.clientes.porId(sessao.clienteId);
    if (!cliente || cliente.companyId !== sessao.companyId) {
      throw new UnauthorizedException('Sessão expirada. Confirme seu telefone novamente.');
    }

    req.clienteAtual = sessao;
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
