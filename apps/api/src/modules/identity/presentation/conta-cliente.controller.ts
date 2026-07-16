import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length, Matches, MinLength } from 'class-validator';
import {
  AgendarComCreditoContaResponse,
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
import { AgendarComCreditoUseCase } from '../../scheduling/application/agendar-com-credito.usecase';
import { AgendamentosClienteQueryService } from '../../scheduling/infrastructure/agendamentos-cliente-query.service';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { instanteDeDataHoraLocal } from '../../../shared/domain/calendario';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

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

class AgendarComCreditoContaDto {
  @IsString() @MinLength(1) vendaId!: string;
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) barbeiroId!: string;
  @Matches(DATA_ISO) data!: string;
  @Matches(HORA_HHMM) horaInicio!: string;
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
    private readonly agendarComCredito: AgendarComCreditoUseCase,
    private readonly agendamentosCliente: AgendamentosClienteQueryService,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
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
    const [pacotes, proximosAgendamentos] = await Promise.all([
      this.pacotes.listar(atual.companyId, atual.clienteId),
      this.agendamentosCliente.proximos(atual.companyId, atual.clienteId),
    ]);
    return {
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone.e164 },
      pacotes,
      proximosAgendamentos,
    };
  }

  /**
   * Agenda consumindo um crédito de pacote (§8.2) para o CLIENTE autenticado.
   * Reusa `AgendarComCreditoUseCase` (dois agregados na mesma transação, §2.2) —
   * zero regra duplicada. Confere que o pacote é do próprio cliente antes de
   * agir (o usecase só valida a empresa; a posse é responsabilidade desta borda).
   * Sem pagamento — o crédito já foi pago na compra do pacote.
   */
  @ContaCliente()
  @Post('agendamentos')
  async agendar(
    @ClienteAtual() atual: ClienteAutenticado,
    @Body() body: AgendarComCreditoContaDto,
  ): Promise<AgendarComCreditoContaResponse> {
    const venda = await this.vendas.porId(body.vendaId);
    if (!venda || venda.companyId !== atual.companyId || venda.clienteId !== atual.clienteId) {
      throw new ForbiddenException('Pacote não pertence a este cliente');
    }
    const tz = await this.parametros.timezone(atual.companyId);
    const resultado = await this.agendarComCredito.executar({
      companyId: atual.companyId,
      vendaId: body.vendaId,
      itemId: body.itemId,
      barbeiroId: body.barbeiroId,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
    });
    return { atendimentoId: resultado.atendimentoId };
  }
}
