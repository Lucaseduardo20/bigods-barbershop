import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AgendarPublicoResponse,
  BarbeiroPublicoDTO,
  EmpresaPublicaDTO,
  HorariosDisponiveisDTO,
  ServicoDTO,
} from '@bigods/contracts';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { AgendarAvulsoUseCase } from '../application/agendar-avulso.usecase';
import { EmpresaPublicaQueryService } from '../infrastructure/empresa-publica-query.service';
import { HorariosDisponiveisQueryService } from '../infrastructure/horarios-disponiveis-query.service';
import { instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import { Publico } from '../../identity/presentation/auth.decorators';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class ClientePublicoDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class AgendarPublicoDto {
  @IsString() @MinLength(1) companyId!: string;
  @IsString() barbeiroId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @Matches(DATA_ISO) data!: string;
  /** Horário de parede LOCAL (fuso da empresa) — nunca ISO/UTC pré-construído. */
  @Matches(HORA_HHMM) horaInicio!: string;
  @ValidateNested() @Type(() => ClientePublicoDto) cliente!: ClientePublicoDto;
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
  async servicosAtivos(@Query('companyId') companyId?: string): Promise<ServicoDTO[]> {
    const id = this.exigirCompanyId(companyId);
    await this.empresaQuery.empresa(id); // valida tenant (404 se inexistente)
    const servicos = await this.servicos.listar(id);
    return servicos
      .filter((s) => s.ativo)
      .map((s) => ({
        id: s.id,
        nome: s.nome,
        precoAvulsoCentavos: s.precoAvulso.centavos,
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

  @Publico()
  @Post('agendamentos')
  async agendar(@Body() body: AgendarPublicoDto): Promise<AgendarPublicoResponse> {
    const tz = await this.parametros.timezone(body.companyId);
    const resultado = await this.agendarAvulso.executar({
      companyId: body.companyId,
      barbeiroId: body.barbeiroId,
      servicoIds: body.servicoIds,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
      cliente: body.cliente,
      // Pagamento PRESENCIAL, cobrado na conclusão pelo painel — sem PIX/gateway.
      gerarCobranca: false,
    });
    return { atendimentoId: resultado.atendimentoId };
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
