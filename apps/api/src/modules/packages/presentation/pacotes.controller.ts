import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { VendaDePacoteDTO, VenderPacoteResponse } from '@bigods/contracts';
import { VenderPacoteUseCase } from '../application/vender-pacote.usecase';
import { PacotesQueryService } from '../infrastructure/pacotes-query.service';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class ClienteInlineDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class VenderPacoteDto {
  @ValidateNested() @Type(() => ClienteInlineDto) cliente!: ClienteInlineDto;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @IsInt() @IsPositive() valorPagoCentavos!: number;
  @IsBoolean() pagamentoImediato!: boolean;
}

@Controller('pacotes')
export class PacotesController {
  constructor(
    private readonly venderPacote: VenderPacoteUseCase,
    private readonly consulta: PacotesQueryService,
  ) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('clienteId') clienteId?: string,
  ): Promise<VendaDePacoteDTO[]> {
    return this.consulta.listar(usuario.companyId, clienteId);
  }

  @Post()
  async vender(
    @Body() body: VenderPacoteDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<VenderPacoteResponse> {
    return this.venderPacote.executar({
      companyId: usuario.companyId,
      cliente: body.cliente,
      servicoIds: body.servicoIds,
      valorPagoCentavos: body.valorPagoCentavos,
      pagamentoImediato: body.pagamentoImediato,
    });
  }
}
