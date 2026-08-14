import { BadRequestException, Body, Controller, Get, Inject, Patch, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Papel, ParametrosDTO, TabelaDeDescontoDTO } from '@bigods/contracts';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../domain/parametros-da-empresa.repository';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class AtualizarParametrosDto {
  @IsInt() @IsPositive() prazoReagendamentoDias!: number;
  @IsInt() @IsPositive() janelaCancelamentoHoras!: number;
  @IsInt() @IsPositive() janelaReagendamentoHoras!: number;
}

/**
 * Um degrau da tabela de desconto progressivo. Limites de borda existem porque
 * isto é dinheiro cobrado de cliente real: posição 1 não aceita degrau (o
 * primeiro serviço é sempre preço cheio, por definição da regra) e o valor
 * nunca é negativo (seria acréscimo disfarçado de desconto).
 */
class DegrauDto {
  @IsInt() @Min(2) @Max(20) posicao!: number;
  @IsInt() @Min(0) valorCentavos!: number;
}

class DefinirDescontoDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DegrauDto)
  degraus!: DegrauDto[];

  /** Teto do desconto acumulado. Ausente/nulo = sem teto. */
  @IsOptional() @IsInt() @Min(0) tetoCentavos?: number | null;
}

@Controller('parametros')
export class ParametrosController {
  constructor(
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  @Get()
  async obter(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ParametrosDTO> {
    const [prazoReagendamentoDias, janelaCancelamentoHoras, janelaReagendamentoHoras, tz] = await Promise.all([
      this.parametros.prazoReagendamentoDias(usuario.companyId),
      this.parametros.janelaCancelamentoHoras(usuario.companyId),
      this.parametros.janelaReagendamentoHoras(usuario.companyId),
      this.parametros.timezone(usuario.companyId),
    ]);
    return { prazoReagendamentoDias, janelaCancelamentoHoras, janelaReagendamentoHoras, timezone: tz.iana };
  }

  @Papeis(Papel.ADMIN)
  @Patch()
  async atualizar(
    @Body() body: AtualizarParametrosDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ParametrosDTO> {
    await Promise.all([
      this.parametros.definirPrazoReagendamentoDias(usuario.companyId, body.prazoReagendamentoDias),
      this.parametros.definirJanelaCancelamentoHoras(usuario.companyId, body.janelaCancelamentoHoras),
      this.parametros.definirJanelaReagendamentoHoras(usuario.companyId, body.janelaReagendamentoHoras),
    ]);
    const tz = await this.parametros.timezone(usuario.companyId);
    return {
      prazoReagendamentoDias: body.prazoReagendamentoDias,
      janelaCancelamentoHoras: body.janelaCancelamentoHoras,
      janelaReagendamentoHoras: body.janelaReagendamentoHoras,
      timezone: tz.iana,
    };
  }

  /**
   * Tabela de desconto progressivo dos avulsos — a configuração que substituiu
   * os combos fixos do catálogo. Leitura liberada a qualquer staff (o barbeiro
   * precisa saber o que está sendo descontado); escrita só ADMIN, como os
   * demais parâmetros de dinheiro.
   */
  @Get('desconto')
  async obterDesconto(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<TabelaDeDescontoDTO> {
    return this.parametros.tabelaDeDesconto(usuario.companyId);
  }

  @Papeis(Papel.ADMIN)
  @Put('desconto')
  async definirDesconto(
    @Body() body: DefinirDescontoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<TabelaDeDescontoDTO> {
    // Posição repetida seria ambígua ("qual dos dois degraus vale?") — a
    // constraint do banco já recusaria, mas a borda dá a mensagem legível.
    const posicoes = body.degraus.map((d) => d.posicao);
    if (new Set(posicoes).size !== posicoes.length) {
      throw new BadRequestException('Há mais de um degrau para a mesma posição');
    }
    const tabela: TabelaDeDescontoDTO = {
      degraus: body.degraus.map((d) => ({ posicao: d.posicao, valorCentavos: d.valorCentavos })),
      tetoCentavos: body.tetoCentavos ?? null,
    };
    await this.parametros.definirTabelaDeDesconto(usuario.companyId, tabela);
    return this.parametros.tabelaDeDesconto(usuario.companyId);
  }
}
