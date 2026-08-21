import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsArray, ArrayNotEmpty, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import {
  AgendamentoClienteDTO,
  AgendarComCreditoContaResponse,
  AtendimentoDTO,
  ConfirmarLoginClienteResponse,
  IniciarLoginClienteResponse,
  PerfilClienteDTO,
} from '@bigods/contracts';
import { IniciarLoginClienteUseCase } from '../application/iniciar-login-cliente.usecase';
import { ConfirmarLoginClienteUseCase } from '../application/confirmar-login-cliente.usecase';
import { Publico } from './auth.decorators';
import { EhCelularBrasileiro } from '../../../shared/presentation/validadores';
import { EnviaOtp } from './envia-otp.decorator';
import { ClienteAtual, ContaCliente } from './cliente.guard';
import { ClienteAutenticado } from '../infrastructure/cliente-sessao.service';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { PacotesQueryService } from '../../packages/infrastructure/pacotes-query.service';
import { AgendarAvulsoUseCase } from '../../scheduling/application/agendar-avulso.usecase';
import { AgendarComCreditoUseCase } from '../../scheduling/application/agendar-com-credito.usecase';
import { CancelarAtendimentoClienteUseCase } from '../../scheduling/application/cancelar-atendimento-cliente.usecase';
import { ReagendarAtendimentoClienteUseCase } from '../../scheduling/application/reagendar-atendimento-cliente.usecase';
import { SolicitarReembolsoUseCase } from '../../packages/application/solicitar-reembolso.usecase';
import { AgendaQueryService } from '../../scheduling/infrastructure/agenda-query.service';
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
import { creditosDaRequisicao } from '../../scheduling/application/agendar-com-credito.usecase';
import { ClubeQueryService } from '../../packages/infrastructure/clube-query.service';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Login por OTP: no máximo 5 tentativas por telefone a cada 10 minutos (o
 * tracker do `default` é o telefone quando ele vem no corpo).
 *
 * Não confundir com o limite por ORIGEM: quem envia mensagem de verdade também
 * leva `@EnviaOtp()`, que ativa o throttler `otp-origem` (ver `app.module.ts`).
 * São travas para abusos diferentes — martelar UM número vs. varrer MIL.
 */
const THROTTLE_LOGIN = { default: { limit: 5, ttl: 600_000 } };

/**
 * O telefone é validado como CELULAR brasileiro aqui, e não só como "string com
 * 8+ caracteres": é por este endpoint que sai a mensagem de WhatsApp, e telefone
 * fixo nunca vai receber o código. Barrar na borda evita gastar envio (e cota de
 * rate limit) num número que não tem como responder.
 */
class IniciarLoginDto {
  @IsString() @MinLength(1) companyId!: string;
  @EhCelularBrasileiro() telefone!: string;
}

class ConfirmarLoginDto {
  @IsString() @MinLength(1) companyId!: string;
  @EhCelularBrasileiro() telefone!: string;
  @Matches(/^\d{6}$/) codigo!: string;
  @IsString() @Length(0, 4096) desafio!: string;
}

class AgendarComCreditoContaDto {
  @IsString() @MinLength(1) vendaId!: string;
  /** Vários créditos do mesmo pacote = uma visita só (2026-08-21). */
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds?: string[];
  /** DEPRECADO — compatibilidade com o app publicado durante o deploy. */
  @IsOptional() @IsString() @MinLength(1) itemId?: string;
  @IsString() @MinLength(1) barbeiroId!: string;
  @Matches(DATA_ISO) data!: string;
  @Matches(HORA_HHMM) horaInicio!: string;
}

class ReagendarContaDto {
  @Matches(DATA_ISO) data!: string;
  @Matches(HORA_HHMM) horaInicio!: string;
}

class AgendarAvulsoContaDto {
  @IsString() @MinLength(1) barbeiroId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @Matches(DATA_ISO) data!: string;
  @Matches(HORA_HHMM) horaInicio!: string;
  /** FASE 4a (sessão-E, §8.7): abate o saldo residual desta venda, se informado. */
  @IsOptional() @IsString() abaterSaldoDeVendaId?: string;
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
    private readonly clube: ClubeQueryService,
    private readonly agendarAvulso: AgendarAvulsoUseCase,
    private readonly agendarComCredito: AgendarComCreditoUseCase,
    private readonly cancelarAtendimento: CancelarAtendimentoClienteUseCase,
    private readonly reagendarAtendimento: ReagendarAtendimentoClienteUseCase,
    private readonly solicitarReembolso: SolicitarReembolsoUseCase,
    private readonly agenda: AgendaQueryService,
    private readonly agendamentosCliente: AgendamentosClienteQueryService,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  @Publico()
  @Throttle(THROTTLE_LOGIN)
  @EnviaOtp()
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
    const [pacotes, proximosAgendamentos, clube] = await Promise.all([
      this.pacotes.listar(atual.companyId, atual.clienteId),
      this.agendamentosCliente.proximos(atual.companyId, atual.clienteId),
      // Recalculado a cada leitura, de propósito (§Bigod's Club) — não existe
      // coluna de status pra divergir do mundo real.
      this.clube.doCliente(atual.companyId, atual.clienteId),
    ]);
    return {
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone.e164 },
      clube,
      pacotes,
      proximosAgendamentos,
    };
  }

  /**
   * FASE 1 (sessão-E): histórico do cliente — atendimentos que já saíram de
   * AGENDADO (concluídos, cancelados, faltas), do mais recente ao mais
   * antigo. Leitura pura, reusa o read model de `proximos`.
   */
  @ContaCliente()
  @Get('historico')
  async historico(@ClienteAtual() atual: ClienteAutenticado): Promise<AgendamentoClienteDTO[]> {
    return this.agendamentosCliente.historico(atual.companyId, atual.clienteId);
  }

  /**
   * Detalhe de UM atendimento do cliente — reusa o read model rico do
   * painel admin (`AgendaQueryService`, já traz itens/produtos/valores/
   * origem de link). A posse é conferida aqui, na borda (o read model não
   * sabe de cliente autenticado) — mesmo padrão de `agendar()` abaixo.
   */
  @ContaCliente()
  @Get('atendimentos/:id')
  async detalheAtendimento(
    @ClienteAtual() atual: ClienteAutenticado,
    @Param('id') id: string,
  ): Promise<AtendimentoDTO> {
    const atendimento = await this.agenda.porId(id, atual.companyId);
    if (!atendimento || atendimento.cliente.id !== atual.clienteId) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    return atendimento;
  }

  /**
   * FASE 2 (sessão-E, §8.6): cliente cancela o PRÓPRIO agendamento, sozinho.
   * Autorização (posse) e janela de tempo são checadas no caso de uso — a
   * borda só repassa `clienteId` do token, nunca confia em nada do corpo.
   */
  @ContaCliente()
  @Post('atendimentos/:id/cancelar')
  async cancelar(@ClienteAtual() atual: ClienteAutenticado, @Param('id') id: string): Promise<{ ok: true }> {
    await this.cancelarAtendimento.executar({
      atendimentoId: id,
      companyId: atual.companyId,
      clienteId: atual.clienteId,
    });
    return { ok: true };
  }

  /**
   * FASE 3 (sessão-E, §8.6): reagendar o PRÓPRIO agendamento — pro cliente
   * parece só mover a data/hora; por baixo, cancela + cria novo, mesmo
   * serviço/barbeiro, crédito de pacote preservado quando aplicável
   * (`ReagendarAtendimentoClienteUseCase`).
   */
  @ContaCliente()
  @Post('atendimentos/:id/reagendar')
  async reagendar(
    @ClienteAtual() atual: ClienteAutenticado,
    @Param('id') id: string,
    @Body() body: ReagendarContaDto,
  ): Promise<{ atendimentoId: string }> {
    const tz = await this.parametros.timezone(atual.companyId);
    const resultado = await this.reagendarAtendimento.executar({
      atendimentoId: id,
      companyId: atual.companyId,
      clienteId: atual.clienteId,
      novoInicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
    });
    return { atendimentoId: resultado.novoAtendimentoId };
  }

  /**
   * FASE 4a (sessão-E, §8.7): agenda um AVULSO pelo cockpit, com abatimento
   * OPCIONAL de saldo residual de um pacote (regra do resto —
   * `AgendarAvulsoUseCase` já cuida disso). Reusa o mesmo caso de uso do
   * funil público/admin — zero regra duplicada. Nome/telefone vêm do
   * PRÓPRIO cliente autenticado, nunca do corpo da requisição.
   */
  @ContaCliente()
  @Post('agendamentos/avulso')
  async agendarAvulsoConta(
    @ClienteAtual() atual: ClienteAutenticado,
    @Body() body: AgendarAvulsoContaDto,
  ): Promise<{ atendimentoId: string }> {
    const cliente = await this.clientes.porId(atual.clienteId);
    if (!cliente || cliente.companyId !== atual.companyId) {
      throw new NotFoundException('Cliente não encontrado');
    }
    const tz = await this.parametros.timezone(atual.companyId);
    const resultado = await this.agendarAvulso.executar({
      companyId: atual.companyId,
      barbeiroId: body.barbeiroId,
      servicoIds: body.servicoIds,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
      cliente: { nome: cliente.nome, telefone: cliente.telefone.e164 },
      gerarCobranca: false,
      abaterSaldoDeVendaId: body.abaterSaldoDeVendaId ?? null,
    });
    return { atendimentoId: resultado.atendimentoId };
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
      itemIds: creditosDaRequisicao(body),
      barbeiroId: body.barbeiroId,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
    });
    return { atendimentoId: resultado.atendimentoId };
  }

  /**
   * FASE 4b (sessão-E, §8.7): cliente pede reembolso MANUAL do saldo residual
   * de UM pacote (`vendaId`). Reserva o saldo na hora do pedido — depois
   * disso o abatimento (FASE 4a) não enxerga mais nada pra abater nesse
   * pacote. Sem gateway: admin devolve por fora e confirma depois.
   */
  @ContaCliente()
  @Post('pacotes/:vendaId/reembolso')
  async pedirReembolso(
    @ClienteAtual() atual: ClienteAutenticado,
    @Param('vendaId') vendaId: string,
  ): Promise<{ solicitacaoId: string; valorCentavos: number }> {
    return this.solicitarReembolso.executar({
      vendaDePacoteId: vendaId,
      companyId: atual.companyId,
      clienteId: atual.clienteId,
      hoje: new Date(),
    });
  }
}
