import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FormaPagamentoFunil } from '@bigods/contracts';
import {
  AgendarPublicoResponse,
  BarbeiroPublicoDTO,
  EmpresaPublicaDTO,
  HorariosDisponiveisDTO,
  ServicoDTO,
} from '@bigods/contracts';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { precoDeReferencia } from '../../packages/domain/precificacao-pacote';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { AgendarAvulsoUseCase } from '../application/agendar-avulso.usecase';
import { EmpresaPublicaQueryService } from '../infrastructure/empresa-publica-query.service';
import { HorariosDisponiveisQueryService } from '../infrastructure/horarios-disponiveis-query.service';
import { Throttle } from '@nestjs/throttler';
import { instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import { Publico } from '../../identity/presentation/auth.decorators';
import { ClienteAtual, ContaCliente } from '../../identity/presentation/cliente.guard';
import { ClienteAutenticado } from '../../identity/infrastructure/cliente-sessao.service';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class ClientePublicoDto {
  @IsString() @MinLength(1) nome!: string;
}

class AgendarPublicoDto {
  @IsString() @MinLength(1) companyId!: string;
  @IsString() barbeiroId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @Matches(DATA_ISO) data!: string;
  /** Horário de parede LOCAL (fuso da empresa) — nunca ISO/UTC pré-construído. */
  @Matches(HORA_HHMM) horaInicio!: string;
  @ValidateNested() @Type(() => ClientePublicoDto) cliente!: ClientePublicoDto;
  @IsOptional() @IsIn(['online', 'presencial']) formaPagamento?: FormaPagamentoFunil;
  /** Fase 4c: presente quando o cliente entrou pelo link pessoal de um barbeiro. */
  @IsOptional() @IsString() origemLinkBarbeiroId?: string;
}

/**
 * Superfície pública do funil de agendamento (não autenticada). Toda rota é
 * `@Publico()`. A escrita REUSA o caso de uso `AgendarAvulsoUseCase` — as mesmas
 * invariantes de domínio valem (serviço ativo, barbeiro atende, disponibilidade
 * por dia civil local, conflito de horário + EXCLUDE). NUNCA um caminho de
 * escrita que pule validação (anti-padrão §10).
 *
 * O tenant é explícito: o cliente envia `companyId` (o funil é o deploy da
 * própria barbearia). Empresa inexistente → 404, nunca fallback (§2.4).
 */
@Controller('public')
export class BookingPublicoController {
  constructor(
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    private readonly empresaQuery: EmpresaPublicaQueryService,
    private readonly horariosQuery: HorariosDisponiveisQueryService,
    private readonly agendarAvulso: AgendarAvulsoUseCase,
  ) {}

  @Publico()
  @Get('empresa')
  async empresa(@Query('companyId') companyId?: string): Promise<EmpresaPublicaDTO> {
    return this.empresaQuery.empresa(this.exigirCompanyId(companyId));
  }

  @Publico()
  @Get('servicos')
  async servicosAtivos(
    @Query('companyId') companyId?: string,
    @Query('barbeiroId') barbeiroId?: string,
  ): Promise<ServicoDTO[]> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id); // valida tenant (404 se inexistente)
    // §4a: com barbeiro escolhido primeiro, a lista de serviços já vem filtrada
    // pro que ELE atende — mostrar serviço que ele não faz seria fluxo morto.
    const barbeiro = barbeiroId ? await this.barbeiros.porId(barbeiroId) : null;
    const servicos = await this.servicos.listar(id);
    return servicos
      .filter((s) => s.ativo && (!barbeiro || barbeiro.atende(s.id)))
      .map((s) => ({
        id: s.id,
        nome: s.nome,
        // §3.2.2: preço do BARBEIRO escolhido (override ?? referência) — sem
        // barbeiro selecionado ainda, mostra a referência da casa (mesma regra
        // de precoPara com barbeiroDono=null tratada como "sem override").
        precoAvulsoCentavos: (barbeiro ? precoDeReferencia(s, barbeiro) : s.precoAvulso).centavos,
        duracaoMinutos: s.duracao.minutos,
        ativo: s.ativo,
      }));
  }

  @Publico()
  @Get('barbeiros')
  async barbeirosDisponiveis(
    @Query('companyId') companyId?: string,
    @Query('servicoIds') servicoIds?: string,
  ): Promise<BarbeiroPublicoDTO[]> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id);
    const ids = this.parseCsv(servicoIds);
    const barbeiros = await this.barbeiros.listar(id);
    return barbeiros
      .filter((b) => b.ativo && ids.every((servicoId) => b.atende(servicoId)))
      .map((b) => ({ id: b.id, nome: b.nome }));
  }

  /**
   * Link pessoal do barbeiro (§4b) — resolve o slug pra pré-selecionar o
   * barbeiro no funil. Slug inválido/inexistente devolve 404: o FRONT trata
   * isso caindo no funil normal, nunca mostrando erro feio pro cliente.
   */
  @Publico()
  @Get('barbeiro-por-slug')
  async barbeiroPorSlug(
    @Query('companyId') companyId?: string,
    @Query('slug') slug?: string,
  ): Promise<BarbeiroPublicoDTO> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id);
    if (!slug) throw new BadRequestException('Parâmetro slug obrigatório');
    const barbeiro = await this.barbeiros.porSlug(id, slug);
    if (!barbeiro || !barbeiro.ativo) {
      throw new NotFoundException('Barbeiro não encontrado');
    }
    return { id: barbeiro.id, nome: barbeiro.nome };
  }

  @Publico()
  @Get('horarios')
  async horarios(
    @Query('companyId') companyId?: string,
    @Query('barbeiroId') barbeiroId?: string,
    @Query('data') data?: string,
    @Query('servicoIds') servicoIds?: string,
  ): Promise<HorariosDisponiveisDTO> {
    const id = this.exigirCompanyId(companyId);
    if (!barbeiroId) throw new BadRequestException('Parâmetro barbeiroId obrigatório');
    if (!data || !DATA_ISO.test(data)) {
      throw new BadRequestException('Parâmetro data obrigatório (YYYY-MM-DD, dia civil local)');
    }
    const ids = this.parseCsv(servicoIds);
    if (ids.length === 0) throw new BadRequestException('Parâmetro servicoIds obrigatório');
    return this.horariosQuery.disponiveis({ companyId: id, barbeiroId, data, servicoIds: ids });
  }

  /**
   * Sessão de OTP+reserva (Problema 1 — agenda falsa): exige sessão de
   * cliente verificada por OTP (`@ContaCliente()`, reusa o mesmo mecanismo do
   * login do cockpit — nunca constrói OTP de novo). O front garante que essa
   * sessão existe ANTES de chamar este endpoint: ou já tinha uma válida
   * (cliente recorrente, sem repetir OTP), ou acabou de completar
   * `/conta/login/iniciar` + `/conta/login/confirmar` na tela de confirmação
   * do funil. O telefone vem SEMPRE da sessão verificada, nunca do corpo da
   * requisição — impossível reservar/pagar em nome de um telefone que não
   * provou posse.
   *
   * Ainda limita por IP (30 por 10 min) como rede de segurança extra — o
   * rate limit do OTP em si já existe no login (`THROTTLE_LOGIN`).
   */
  @ContaCliente()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post('agendamentos')
  async agendar(
    @ClienteAtual() atual: ClienteAutenticado,
    @Body() body: AgendarPublicoDto,
  ): Promise<AgendarPublicoResponse> {
    if (atual.companyId !== body.companyId) {
      throw new ForbiddenException('Sessão não pertence a esta empresa');
    }
    const cliente = await this.clientes.porId(atual.clienteId);
    if (!cliente || cliente.companyId !== body.companyId) {
      throw new NotFoundException('Cliente não encontrado');
    }
    const tz = await this.parametros.timezone(body.companyId);
    // online → gera cobrança PIX na hora (reserva TEMPORÁRIA); presencial
    // (default) → reserva FIRME direto, cobra na conclusão.
    const online = body.formaPagamento === 'online';
    const resultado = await this.agendarAvulso.executar({
      companyId: body.companyId,
      barbeiroId: body.barbeiroId,
      servicoIds: body.servicoIds,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
      cliente: { nome: body.cliente.nome, telefone: cliente.telefone.e164 },
      gerarCobranca: online,
      origemLinkBarbeiroId: body.origemLinkBarbeiroId ?? null,
    });
    return {
      atendimentoId: resultado.atendimentoId,
      intencaoId: resultado.cobranca?.intencaoId ?? null,
      cobranca: resultado.cobranca,
    };
  }

  private exigirCompanyId(companyId?: string): string {
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');
    return companyId;
  }

  private parseCsv(csv?: string): string[] {
    if (!csv) return [];
    return csv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
}
