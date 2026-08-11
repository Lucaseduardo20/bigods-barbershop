import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
import { SolicitacaoDeReembolsoDTO, VendaDePacoteDTO, VenderPacoteResponse } from '@bigods/contracts';
import { VenderPacoteUseCase } from '../application/vender-pacote.usecase';
import { ConfirmarPagamentoPresencialUseCase } from '../application/confirmar-pagamento-presencial.usecase';
import { ConfirmarReembolsoUseCase } from '../application/confirmar-reembolso.usecase';
import { PacotesQueryService } from '../infrastructure/pacotes-query.service';
import { UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class ClienteInlineDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class VenderPacoteDto {
  @IsString() @MinLength(1) barbeiroId!: string;
  @ValidateNested() @Type(() => ClienteInlineDto) cliente!: ClienteInlineDto;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @IsInt() @IsPositive() valorPagoCentavos!: number;
  @IsBoolean() pagamentoImediato!: boolean;
}

@Controller('pacotes')
export class PacotesController {
  constructor(
    private readonly venderPacote: VenderPacoteUseCase,
    private readonly confirmarPagamentoPresencial: ConfirmarPagamentoPresencialUseCase,
    private readonly confirmarReembolso: ConfirmarReembolsoUseCase,
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
      barbeiroId: body.barbeiroId,
      servicoIds: body.servicoIds,
      valorPagoCentavos: body.valorPagoCentavos,
      pagamentoImediato: body.pagamentoImediato,
    });
  }

  /**
   * Bug 8: confirma manualmente o pagamento presencial ("na barbearia") de um
   * pacote AGUARDANDO — mesmo caminho idempotente do webhook (§ domínio),
   * só que disparado pelo admin em vez do gateway.
   */
  @Post(':id/confirmar-pagamento')
  async confirmarPagamento(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ processado: boolean }> {
    return this.confirmarPagamentoPresencial.executar({ companyId: usuario.companyId, vendaId: id });
  }

  /**
   * FASE 4b (sessão-E, §8.7): lista de solicitações de reembolso PENDENTES —
   * admin vê e decide devolver por fora (PIX manual).
   */
  @Get('reembolsos/pendentes')
  async reembolsosPendentes(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<SolicitacaoDeReembolsoDTO[]> {
    return this.consulta.reembolsosPendentes(usuario.companyId);
  }

  /**
   * Admin confirma que já devolveu o dinheiro (reembolso é sempre manual,
   * sem gateway) — fecha a solicitação e move o saldo reservado pra
   * `saldoReembolsado` no pacote.
   */
  @Post('reembolsos/:id/confirmar')
  async confirmarReembolsoSolicitado(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.confirmarReembolso.executar({
      solicitacaoId: id,
      companyId: usuario.companyId,
      hoje: new Date(),
    });
    return { ok: true };
  }
}
