import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AgendarResponse,
  AtendimentoDTO,
  FormaPagamento,
  Papel,
} from '@bigods/contracts';
import { AgendarAvulsoUseCase } from '../application/agendar-avulso.usecase';
import { AgendarComCreditoUseCase } from '../application/agendar-com-credito.usecase';
import { ConcluirAtendimentoUseCase } from '../application/concluir-atendimento.usecase';
import { CancelarAtendimentoUseCase } from '../application/cancelar-atendimento.usecase';
import { RegistrarNaoComparecimentoUseCase } from '../application/registrar-nao-comparecimento.usecase';
import { AdicionarItemAtendimentoUseCase } from '../application/adicionar-item-atendimento.usecase';
import { AdicionarProdutoAtendimentoUseCase } from '../application/adicionar-produto-atendimento.usecase';
import { AgendaQueryService } from '../infrastructure/agenda-query.service';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';
import { diferencaDiasCivis, instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "No máximo 1 mês" — interpretado como 31 dias corridos (inclusive nas duas pontas). */
// DECISAO_PENDENTE: "1 mês" poderia significar mês-calendário (28-31 dias variável); usei 31 dias fixos por simplicidade.
const PERIODO_MAXIMO_DIAS = 31;

class ClienteInlineDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class AgendarAvulsoDto {
  @IsString() barbeiroId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @Matches(DATA_ISO) data!: string;
  /** Horário de parede LOCAL (fuso da empresa) — nunca ISO/UTC pré-construído. */
  @Matches(HORA_HHMM) horaInicio!: string;
  @ValidateNested() @Type(() => ClienteInlineDto) cliente!: ClienteInlineDto;
  @IsOptional() @IsBoolean() gerarCobranca?: boolean;
}

class AgendarComCreditoDto {
  @IsString() vendaId!: string;
  @IsString() itemId!: string;
  @IsString() barbeiroId!: string;
  @Matches(DATA_ISO) data!: string;
  @Matches(HORA_HHMM) horaInicio!: string;
}

class ConcluirDto {
  @IsOptional() @IsEnum(FormaPagamento) formaPagamento?: FormaPagamento;
}

class CancelarDto {
  @IsString() @MinLength(1) motivo!: string;
}

class AdicionarItemDto {
  @IsString() @MinLength(1) servicoId!: string;
}

class AdicionarProdutoDto {
  @IsString() @MinLength(1) produtoId!: string;
  @IsOptional() @IsInt() @IsPositive() quantidade?: number;
}

@Controller('atendimentos')
export class AtendimentosController {
  constructor(
    private readonly agendarAvulso: AgendarAvulsoUseCase,
    private readonly agendarComCredito: AgendarComCreditoUseCase,
    private readonly concluir: ConcluirAtendimentoUseCase,
    private readonly cancelar: CancelarAtendimentoUseCase,
    private readonly registrarFalta: RegistrarNaoComparecimentoUseCase,
    private readonly adicionarItem: AdicionarItemAtendimentoUseCase,
    private readonly adicionarProduto: AdicionarProdutoAtendimentoUseCase,
    private readonly agenda: AgendaQueryService,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendasDePacote: VendaDePacoteRepository,
  ) {}

  @Get()
  async listar(
    @Query('de') de: string,
    @Query('ate') ate: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('barbeiroId') barbeiroId?: string,
  ): Promise<AtendimentoDTO[]> {
    if (!de || !DATA_ISO.test(de) || !ate || !DATA_ISO.test(ate)) {
      throw new BadRequestException('Parâmetros de/ate obrigatórios (YYYY-MM-DD, dia civil local)');
    }
    if (de > ate) {
      throw new BadRequestException('Parâmetro de deve ser anterior ou igual a ate');
    }
    if (diferencaDiasCivis(de, ate) > PERIODO_MAXIMO_DIAS) {
      throw new BadRequestException(`Período máximo de consulta é de ${PERIODO_MAXIMO_DIAS} dias`);
    }
    // Barbeiro sem papel de admin só enxerga a própria agenda
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    const filtroBarbeiro = ehAdmin ? barbeiroId : usuario.barbeiroId;
    const tz = await this.parametros.timezone(usuario.companyId);
    return this.agenda.listar({
      companyId: usuario.companyId,
      deLocal: de,
      ateLocal: ate,
      tz,
      barbeiroId: filtroBarbeiro,
    });
  }

  @Get(':id')
  async detalhe(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoDTO> {
    const atendimento = await this.agenda.porId(id, usuario.companyId);
    if (!atendimento) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    if (!ehAdmin && atendimento.barbeiro.id !== usuario.barbeiroId) {
      throw new ForbiddenException('Barbeiro só visualiza os próprios atendimentos');
    }
    return atendimento;
  }

  @Post()
  async criarAvulso(
    @Body() body: AgendarAvulsoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AgendarResponse> {
    const tz = await this.parametros.timezone(usuario.companyId);
    const resultado = await this.agendarAvulso.executar({
      companyId: usuario.companyId,
      barbeiroId: body.barbeiroId,
      servicoIds: body.servicoIds,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
      cliente: body.cliente,
      gerarCobranca: body.gerarCobranca,
      // Sessão de OTP+reserva (Problema 3): cota de presenciais é anti-abuso
      // do canal de auto-atendimento — o admin agenda por julgamento próprio,
      // sem essa trava.
      aplicarCotaPresencial: false,
      // Mesma razão: a janela de 30 dias é trava do auto-atendimento. O admin
      // precisa poder encaixar um cliente daqui a três meses se a operação pedir.
      aplicarJanelaDeAgendamento: false,
    });
    return { atendimentoId: resultado.atendimentoId, cobranca: resultado.cobranca };
  }

  /**
   * Agendar consumindo crédito. ACL (2026-08-18): barbeiro não-admin só mexe
   * em pacote comprado COM ELE, e o atendimento sai no nome dele — mesmo
   * escopo da agenda e da listagem de pacotes. Pacote comprado sem barbeiro
   * escolhido não é de ninguém em particular: quem decide quem atende é o
   * admin. A checagem é aqui, na borda, como no cockpit do cliente.
   */
  @Post('com-credito')
  async criarComCredito(
    @Body() body: AgendarComCreditoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AgendarResponse> {
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    if (!ehAdmin) {
      const venda = await this.vendasDePacote.porId(body.vendaId);
      if (!venda || venda.companyId !== usuario.companyId) {
        throw new NotFoundException('Pacote não encontrado');
      }
      if (venda.barbeiroId !== usuario.barbeiroId) {
        throw new ForbiddenException('Este pacote não foi comprado com você');
      }
      if (body.barbeiroId !== usuario.barbeiroId) {
        throw new ForbiddenException('Você só pode agendar em seu próprio nome');
      }
    }
    const tz = await this.parametros.timezone(usuario.companyId);
    const resultado = await this.agendarComCredito.executar({
      companyId: usuario.companyId,
      vendaId: body.vendaId,
      itemId: body.itemId,
      barbeiroId: body.barbeiroId,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
    });
    return { atendimentoId: resultado.atendimentoId, cobranca: null };
  }

  /** Item 3 da sessão 2026-07-16 (walk-in add-on): adiciona serviço ANTES de concluir. */
  @Post(':id/itens')
  async adicionarItemAtendimento(
    @Param('id') id: string,
    @Body() body: AdicionarItemDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.adicionarItem.executar({ atendimentoId: id, servicoId: body.servicoId, usuario });
    return { ok: true };
  }

  /** Item 4a da sessão 2026-07-16: produto vendido junto do atendimento, ANTES de concluir. */
  @Post(':id/produtos')
  async adicionarProdutoAtendimento(
    @Param('id') id: string,
    @Body() body: AdicionarProdutoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.adicionarProduto.executar({
      atendimentoId: id,
      produtoId: body.produtoId,
      quantidade: body.quantidade ?? 1,
      usuario,
    });
    return { ok: true };
  }

  @Post(':id/concluir')
  async concluirAtendimento(
    @Param('id') id: string,
    @Body() body: ConcluirDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.concluir.executar({
      atendimentoId: id,
      formaPagamento: body.formaPagamento,
      usuario,
    });
    return { ok: true };
  }

  @Post(':id/cancelar')
  async cancelarAtendimento(
    @Param('id') id: string,
    @Body() body: CancelarDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.cancelar.executar({ atendimentoId: id, motivo: body.motivo, usuario });
    return { ok: true };
  }

  @Post(':id/nao-compareceu')
  async naoCompareceu(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.registrarFalta.executar({ atendimentoId: id, usuario });
    return { ok: true };
  }
}
