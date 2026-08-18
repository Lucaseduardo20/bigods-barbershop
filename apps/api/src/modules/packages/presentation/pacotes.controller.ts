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
import { Papel, SolicitacaoDeReembolsoDTO, VendaDePacoteDTO, VenderPacoteResponse } from '@bigods/contracts';
import { VenderPacoteUseCase } from '../application/vender-pacote.usecase';
import { ConfirmarPagamentoPresencialUseCase } from '../application/confirmar-pagamento-presencial.usecase';
import { ConfirmarReembolsoUseCase } from '../application/confirmar-reembolso.usecase';
import { PacotesQueryService } from '../infrastructure/pacotes-query.service';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class ClienteInlineDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class VenderPacoteDto {
  /** Opcional (2026-08-18): com barbeiro, só ele atende os serviços do pacote. */
  @IsOptional() @IsString() @MinLength(1) barbeiroId?: string;
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

  /**
   * Barbeiro não-admin só enxerga os pacotes comprados COM ELE (2026-08-18) —
   * mesmo escopo da agenda e do extrato. Filtro no BACKEND, não na tela: o
   * front esconder é conveniência, isto aqui é a garantia.
   */
  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('clienteId') clienteId?: string,
  ): Promise<VendaDePacoteDTO[]> {
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    return this.consulta.listar(
      usuario.companyId,
      clienteId,
      ehAdmin ? undefined : usuario.barbeiroId,
    );
  }

  /** Vender pacote é ação de caixa — só admin (2026-08-18). */
  @Papeis(Papel.ADMIN)
  @Post()
  async vender(
    @Body() body: VenderPacoteDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<VenderPacoteResponse> {
    return this.venderPacote.executar({
      companyId: usuario.companyId,
      cliente: body.cliente,
      barbeiroId: body.barbeiroId ?? null,
      servicoIds: body.servicoIds,
      valorPagoCentavos: body.valorPagoCentavos,
      pagamentoImediato: body.pagamentoImediato,
    });
  }

  /**
   * Bug 8: confirma manualmente o pagamento presencial ("na barbearia") de um
   * pacote AGUARDANDO — mesmo caminho idempotente do webhook (§ domínio),
   * só que disparado pelo admin em vez do gateway. Confirmar dinheiro que
   * entrou é caixa: admin-only (2026-08-18).
   */
  @Papeis(Papel.ADMIN)
  @Post(':id/confirmar-pagamento')
  async confirmarPagamento(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ processado: boolean }> {
    return this.confirmarPagamentoPresencial.executar({ companyId: usuario.companyId, vendaId: id });
  }

  /**
   * FASE 4b (sessão-E, §8.7): lista de solicitações de reembolso PENDENTES —
   * admin vê e decide devolver por fora (PIX manual). `@Papeis(ADMIN)`
   * corrigido nesta sessão (ACL) — endpoint nasceu sem guard, aberto pra
   * qualquer staff autenticado; o comentário já dizia "admin decide", só
   * faltava o backend impor.
   */
  @Papeis(Papel.ADMIN)
  @Get('reembolsos/pendentes')
  async reembolsosPendentes(
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<SolicitacaoDeReembolsoDTO[]> {
    return this.consulta.reembolsosPendentes(usuario.companyId);
  }

  /**
   * Admin confirma que já devolveu o dinheiro (reembolso é sempre manual,
   * sem gateway) — fecha a solicitação e move o saldo reservado pra
   * `saldoReembolsado` no pacote. `@Papeis(ADMIN)` — mesma correção de ACL
   * do endpoint acima.
   */
  @Papeis(Papel.ADMIN)
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
