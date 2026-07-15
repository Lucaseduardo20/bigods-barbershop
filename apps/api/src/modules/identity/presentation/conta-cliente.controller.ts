import { Body, Controller, Get, Inject, NotFoundException, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length, Matches, MinLength } from 'class-validator';
import {
  ConfirmarLoginClienteResponse,
  IniciarLoginClienteResponse,
  PerfilClienteDTO,
} from '@bigods/contracts';
import { IniciarLoginClienteUseCase } from '../application/iniciar-login-cliente.usecase';
import { ConfirmarLoginClienteUseCase } from '../application/confirmar-login-cliente.usecase';
import { Publico } from './auth.decorators';
import { ClienteAtual, ContaCliente } from './cliente.guard';
import { ClienteAutenticado } from '../infrastructure/cliente-sessao.service';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { PacotesQueryService } from '../../packages/infrastructure/pacotes-query.service';

/** Login por OTP: no máximo 5 tentativas por telefone a cada 10 minutos. */
const THROTTLE_LOGIN = { default: { limit: 5, ttl: 600_000 } };

class IniciarLoginDto {
  @IsString() @MinLength(1) companyId!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class ConfirmarLoginDto {
  @IsString() @MinLength(1) companyId!: string;
  @IsString() @MinLength(8) telefone!: string;
  @Matches(/^\d{6}$/) codigo!: string;
  @IsString() @Length(0, 4096) desafio!: string;
}

/**
 * Área logada do cliente final (não confundir com o painel de staff).
 * `iniciar`/`confirmar` são públicos (ainda não há sessão) mas rate-limited por
 * telefone; `perfil` exige o token de cliente emitido na confirmação.
 */
@Controller('conta')
export class ContaClienteController {
  constructor(
    private readonly iniciarLogin: IniciarLoginClienteUseCase,
    private readonly confirmarLogin: ConfirmarLoginClienteUseCase,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    private readonly pacotes: PacotesQueryService,
  ) {}

  @Publico()
  @Throttle(THROTTLE_LOGIN)
  @Post('login/iniciar')
  async iniciar(@Body() body: IniciarLoginDto): Promise<IniciarLoginClienteResponse> {
    const r = await this.iniciarLogin.executar({ companyId: body.companyId, telefone: body.telefone });
    return { desafio: r.desafio, expiraEm: r.expiraEm.toISOString(), codigoDemo: r.codigoDemo };
  }

  @Publico()
  @Throttle(THROTTLE_LOGIN)
  @Post('login/confirmar')
  async confirmar(@Body() body: ConfirmarLoginDto): Promise<ConfirmarLoginClienteResponse> {
    return this.confirmarLogin.executar({
      companyId: body.companyId,
      telefone: body.telefone,
      codigo: body.codigo,
      desafio: body.desafio,
    });
  }

  @ContaCliente()
  @Get('perfil')
  async perfil(@ClienteAtual() atual: ClienteAutenticado): Promise<PerfilClienteDTO> {
    const cliente = await this.clientes.porId(atual.clienteId);
    if (!cliente || cliente.companyId !== atual.companyId) {
      throw new NotFoundException('Cliente não encontrado');
    }
    const pacotes = await this.pacotes.listar(atual.companyId, atual.clienteId);
    return {
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone.e164 },
      pacotes,
    };
  }
}
