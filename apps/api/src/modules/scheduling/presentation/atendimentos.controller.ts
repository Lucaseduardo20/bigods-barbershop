import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
  IsISO8601,
  IsOptional,
  IsString,
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
import { AgendaQueryService } from '../infrastructure/agenda-query.service';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class ClienteInlineDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class AgendarAvulsoDto {
  @IsString() barbeiroId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @IsISO8601() inicio!: string;
  @ValidateNested() @Type(() => ClienteInlineDto) cliente!: ClienteInlineDto;
  @IsOptional() @IsBoolean() gerarCobranca?: boolean;
}

class AgendarComCreditoDto {
  @IsString() vendaId!: string;
  @IsString() itemId!: string;
  @IsString() barbeiroId!: string;
  @IsISO8601() inicio!: string;
}

class ConcluirDto {
  @IsOptional() @IsEnum(FormaPagamento) formaPagamento?: FormaPagamento;
}

class CancelarDto {
  @IsString() @MinLength(1) motivo!: string;
}

@Controller('atendimentos')
export class AtendimentosController {
  constructor(
    private readonly agendarAvulso: AgendarAvulsoUseCase,
    private readonly agendarComCredito: AgendarComCreditoUseCase,
    private readonly concluir: ConcluirAtendimentoUseCase,
    private readonly cancelar: CancelarAtendimentoUseCase,
    private readonly registrarFalta: RegistrarNaoComparecimentoUseCase,
    private readonly agenda: AgendaQueryService,
  ) {}

  @Get()
  async listar(
    @Query('de') de: string,
    @Query('ate') ate: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('barbeiroId') barbeiroId?: string,
  ): Promise<AtendimentoDTO[]> {
    if (!de || !ate) throw new BadRequestException('Parâmetros de/ate obrigatórios (ISO 8601)');
    // Barbeiro sem papel de admin só enxerga a própria agenda
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    const filtroBarbeiro = ehAdmin ? barbeiroId : usuario.barbeiroId;
    return this.agenda.listar({
      companyId: usuario.companyId,
      de: new Date(de),
      ate: new Date(ate),
      barbeiroId: filtroBarbeiro,
    });
  }

  @Post()
  async criarAvulso(
    @Body() body: AgendarAvulsoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AgendarResponse> {
    const resultado = await this.agendarAvulso.executar({
      companyId: usuario.companyId,
      barbeiroId: body.barbeiroId,
      servicoIds: body.servicoIds,
      inicio: new Date(body.inicio),
      cliente: body.cliente,
      gerarCobranca: body.gerarCobranca,
    });
    return { atendimentoId: resultado.atendimentoId, cobranca: resultado.cobranca };
  }

  @Post('com-credito')
  async criarComCredito(
    @Body() body: AgendarComCreditoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AgendarResponse> {
    const resultado = await this.agendarComCredito.executar({
      companyId: usuario.companyId,
      vendaId: body.vendaId,
      itemId: body.itemId,
      barbeiroId: body.barbeiroId,
      inicio: new Date(body.inicio),
    });
    return { atendimentoId: resultado.atendimentoId, cobranca: null };
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
