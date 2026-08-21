import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { SincronizarStatusDoClubeUseCase } from './sincronizar-status-do-clube.usecase';

/**
 * Liga os fatos do domínio à reconciliação do log do clube (2026-08-21).
 *
 * A lista de eventos é generosa de propósito: o reconciliador é idempotente e
 * barato, então ouvir demais não faz mal — e ouvir de menos só ATRASA a linha do
 * log, nunca corrompe o status (que é calculado na leitura).
 *
 * Os eventos de item (`ItemDoPacoteConsumido/Expirado`) não carregam
 * `clienteId`; ele vem da venda, resolvida aqui.
 */
@Injectable()
export class ClubeHandlers {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sincronizar: SincronizarStatusDoClubeUseCase,
  ) {}

  /** Compra do pacote: pode ser a entrada no clube (se já vem pago). */
  @OnEvent('PacoteVendido')
  async aoVenderPacote(e: { companyId: string; clienteId: string }): Promise<void> {
    await this.sincronizar.executar({
      companyId: e.companyId,
      clienteId: e.clienteId,
      causa: 'pacote vendido',
    });
  }

  /**
   * Pagamento confirmado — é AQUI que o crédito passa a existir de verdade, no
   * caminho em que o pacote nasce AGUARDANDO (PIX, ou confirmação no balcão).
   */
  @OnEvent('PagamentoConfirmado')
  async aoConfirmarPagamento(e: {
    companyId: string;
    referencia: { tipo: string; vendaDePacoteId?: string };
  }): Promise<void> {
    if (e.referencia?.tipo !== 'VENDA_DE_PACOTE' || !e.referencia.vendaDePacoteId) return;
    const venda = await this.prisma.vendaDePacote.findUnique({
      where: { id: e.referencia.vendaDePacoteId },
      select: { clienteId: true },
    });
    if (!venda) return;
    await this.sincronizar.executar({
      companyId: e.companyId,
      clienteId: venda.clienteId,
      causa: 'pagamento do pacote confirmado',
    });
  }

  /** Crédito consumido: pode ter sido o último (ATIVO → INATIVO). */
  @OnEvent('ItemDoPacoteConsumido')
  async aoConsumirItem(e: { vendaId: string }): Promise<void> {
    await this.pelaVenda(e.vendaId, 'crédito de pacote consumido');
  }

  /** Crédito expirado: mesmo efeito do consumo, por outro caminho. */
  @OnEvent('ItemDoPacoteExpirado')
  async aoExpirarItem(e: { vendaId: string }): Promise<void> {
    await this.pelaVenda(e.vendaId, 'crédito de pacote expirado');
  }

  /**
   * Atendimento marcado. Se for avulso de quem está sem crédito, é a saída do
   * clube; se for de quem tem crédito, o reconciliador não vê mudança nenhuma e
   * não grava nada.
   */
  @OnEvent('AtendimentoAgendado')
  async aoAgendar(e: { companyId: string; clienteId: string }): Promise<void> {
    await this.sincronizar.executar({
      companyId: e.companyId,
      clienteId: e.clienteId,
      causa: 'atendimento marcado',
    });
  }

  /** Falta pode expirar um crédito na segunda vez — e aí o status muda. */
  @OnEvent('ClienteFaltou')
  async aoFaltar(e: { companyId: string; clienteId: string }): Promise<void> {
    await this.sincronizar.executar({
      companyId: e.companyId,
      clienteId: e.clienteId,
      causa: 'falta registrada',
    });
  }

  /** Cancelamento devolve crédito: quem havia esgotado pode voltar a ativo. */
  @OnEvent('AtendimentoCancelado')
  async aoCancelar(e: { companyId: string; atendimentoId: string }): Promise<void> {
    const atendimento = await this.prisma.atendimento.findUnique({
      where: { id: e.atendimentoId },
      select: { clienteId: true },
    });
    if (!atendimento) return;
    await this.sincronizar.executar({
      companyId: e.companyId,
      clienteId: atendimento.clienteId,
      causa: 'atendimento cancelado',
    });
  }

  private async pelaVenda(vendaId: string, causa: string): Promise<void> {
    const venda = await this.prisma.vendaDePacote.findUnique({
      where: { id: vendaId },
      select: { companyId: true, clienteId: true },
    });
    if (!venda) return;
    await this.sincronizar.executar({
      companyId: venda.companyId,
      clienteId: venda.clienteId,
      causa,
    });
  }
}
