import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  Papel,
  SolicitacaoDeReembolsoDTO,
  StatusSolicitacaoReembolso,
  VendaDePacoteDTO,
  VenderPacoteResponse,
} from '@bigods/contracts';
import { VenderPacoteUseCase } from '../application/vender-pacote.usecase';
import { ConfirmarPagamentoPresencialUseCase } from '../application/confirmar-pagamento-presencial.usecase';
import { ConfirmarReembolsoUseCase } from '../application/confirmar-reembolso.usecase';
import {
  AgendarReembolsoUseCase,
  CancelarAgendamentoDeReembolsoUseCase,
} from '../application/agendar-reembolso.usecase';
import { PacotesQueryService } from '../infrastructure/pacotes-query.service';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class ClienteInlineDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

/**
 * Status que a tela de reembolsos consulta. Lista explícita, não
 * `Object.values(StatusSolicitacaoReembolso)`: `REEMBOLSADO` é histórico e não tem
 * aba, e enumerar aqui é o que impede uma aba nova aparecer por acidente quando o
 * enum crescer.
 */
const STATUS_DE_REEMBOLSO = [
  StatusSolicitacaoReembolso.PENDENTE,
  StatusSolicitacaoReembolso.AGENDADO,
  StatusSolicitacaoReembolso.FALHOU,
  StatusSolicitacaoReembolso.REEMBOLSADO,
] as const;

class AgendarReembolsoDto {
  /**
   * Dias até executar. Ausente = padrão do deploy (`REEMBOLSO_PRAZO_DIAS`).
   * **`0` = agora.** O teto de 180 é o prazo máximo de estorno de cartão no
   * Mercado Pago — agendar além disso garantiria falha no dia da execução.
   */
  @IsOptional() @IsInt() @Min(0) @Max(180) prazoDias?: number;
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
    private readonly agendarReembolsoUseCase: AgendarReembolsoUseCase,
    private readonly cancelarAgendamento: CancelarAgendamentoDeReembolsoUseCase,
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
   * Solicitações de um STATUS (2026-08-27) — as três abas da tela de reembolsos:
   * `PENDENTE` (decidir), `AGENDADO` (a caminho) e `FALHOU` (precisa de gente).
   *
   * A aba de falhados é o que `followup.md` #1 exigia: sem ela, um estorno que
   * esgotou as tentativas — quase sempre por saldo insuficiente na conta do
   * gateway — sumiria num log, e quem descobriria seria o cliente.
   */
  @Papeis(Papel.ADMIN)
  @Get('reembolsos')
  async reembolsosPorStatus(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('status') status?: string,
  ): Promise<SolicitacaoDeReembolsoDTO[]> {
    const valido = STATUS_DE_REEMBOLSO.find((s) => s === status);
    if (!valido) {
      throw new BadRequestException(
        `status inválido — use um de: ${STATUS_DE_REEMBOLSO.join(', ')}.`,
      );
    }
    return this.consulta.reembolsosPorStatus(usuario.companyId, valido);
  }

  /**
   * Agenda a execução do estorno pelo gateway.
   *
   * Os três botões da tela caem aqui: "agendar (31 dias)" sem corpo, "antecipar" e
   * "tentar de novo" com `prazoDias: 0`. É a mesma transição — definir *quando*
   * executar —, e três endpoints seriam três lugares para a regra divergir.
   *
   * **Não chama o gateway.** Agenda, e o job executa (a cada 10 min). Um único
   * caminho de execução é o que mantém a chave de idempotência estável e a
   * contagem de tentativas num só lugar.
   */
  @Papeis(Papel.ADMIN)
  @Post('reembolsos/:id/agendar')
  async agendarReembolso(
    @Param('id') id: string,
    @Body() body: AgendarReembolsoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true; agendadaPara: string; imediato: boolean }> {
    const r = await this.agendarReembolsoUseCase.executar({
      solicitacaoId: id,
      companyId: usuario.companyId,
      ...(body.prazoDias === undefined ? {} : { prazoDias: body.prazoDias }),
    });
    return { ok: true, ...r };
  }

  /**
   * Desfaz o agendamento: volta para PENDENTE.
   *
   * Existe porque `confirmar` recusa uma solicitação AGENDADA de propósito —
   * devolver à mão o que já tem execução a caminho pagaria duas vezes. Cancelar
   * NÃO desiste de devolver: o saldo do pacote segue reservado.
   */
  @Papeis(Papel.ADMIN)
  @Post('reembolsos/:id/cancelar-agendamento')
  async cancelarAgendamentoDeReembolso(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.cancelarAgendamento.executar({ solicitacaoId: id, companyId: usuario.companyId });
    return { ok: true };
  }

  /**
   * Admin confirma que já devolveu o dinheiro POR FORA (PIX manual, dinheiro) —
   * fecha a solicitação e move o saldo reservado pra `saldoReembolsado` no pacote.
   *
   * Segue existindo, e é o único caminho para pacote pago presencialmente: não há
   * transação online para estornar. `@Papeis(ADMIN)` — correção de ACL de uma
   * sessão anterior.
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
