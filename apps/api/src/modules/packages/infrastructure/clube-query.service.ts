import { Injectable } from '@nestjs/common';
import {
  ClubeDoClienteDTO,
  StatusDoClube,
  StatusItemPacote,
  StatusPagamento,
} from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { AvulsoParaStatus, CreditoParaStatus, statusDoClube } from '../domain/status-do-clube';

/**
 * Leitura do estado no Bigod's Club (2026-08-21). Monta os dois conjuntos que a
 * função pura `statusDoClube` precisa e devolve o resultado — nenhuma regra de
 * negócio vive aqui.
 *
 * ★ Não existe coluna de status: cada leitura recalcula. O custo é duas queries
 * por cliente, contra a certeza de nunca mostrar um status que divergiu do
 * mundo real.
 */
@Injectable()
export class ClubeQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async doCliente(companyId: string, clienteId: string): Promise<ClubeDoClienteDTO> {
    const status = await this.statusDe(companyId, clienteId);
    const [ultimoEvento, creditosVivos] = await Promise.all([
      this.prisma.eventoDoClube.findFirst({
        where: { clienteId },
        orderBy: { ocorridoEm: 'desc' },
      }),
      this.prisma.itemDoPacote.count({
        where: {
          venda: { companyId, clienteId, statusPagamento: 'PAGO' },
          status: { in: ['DISPONIVEL', 'SEGUNDA_CHANCE', 'AGENDADO'] },
        },
      }),
    ]);

    return {
      status,
      // `desde` só faz sentido se o log já registrou a entrada NESTE status.
      desde:
        ultimoEvento && ultimoEvento.statusNovo === status
          ? ultimoEvento.ocorridoEm.toISOString()
          : null,
      creditosVivos,
    };
  }

  /** Só o status — usado pelo reconciliador, que não precisa do resto. */
  async statusDe(companyId: string, clienteId: string): Promise<StatusDoClube> {
    const [itens, avulsos] = await Promise.all([
      this.prisma.itemDoPacote.findMany({
        where: { venda: { companyId, clienteId } },
        select: {
          status: true,
          prazoReagendamentoAte: true,
          deixouDeExistirEm: true,
          atendimentoId: true,
          venda: { select: { statusPagamento: true } },
        },
      }),
      this.prisma.atendimento.findMany({
        where: { companyId, clienteId, origem: 'AVULSO' },
        select: { criadoEm: true },
      }),
    ]);

    // O instante em que o crédito morreu vem GRAVADO (`deixouDeExistirEm`).
    //
    // O fallback abaixo é só para linha que o backfill não alcançou (item
    // CONSUMIDO sem atendimento vinculado, por exemplo). E ele NÃO usa mais o
    // `fim` do atendimento como antes: aquilo produzia data no futuro quando a
    // conclusão acontecia adiantada, e um avulso marcado no meio deixava de
    // rebaixar o cliente — o bug que trouxe esta coluna.
    const creditos: CreditoParaStatus[] = itens.map((i) => ({
      statusPagamentoDaVenda: StatusPagamento[i.venda.statusPagamento],
      statusDoItem: StatusItemPacote[i.status],
      deixouDeViverEm: i.deixouDeExistirEm ?? (i.status === 'EXPIRADO' ? i.prazoReagendamentoAte : null),
    }));
    const paraStatus: AvulsoParaStatus[] = avulsos.map((a) => ({ criadoEm: a.criadoEm }));

    return statusDoClube({ creditos, avulsos: paraStatus });
  }

}
