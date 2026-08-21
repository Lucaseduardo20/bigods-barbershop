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
          atendimentoId: true,
          venda: { select: { statusPagamento: true } },
        },
      }),
      this.prisma.atendimento.findMany({
        where: { companyId, clienteId, origem: 'AVULSO' },
        select: { criadoEm: true },
      }),
    ]);

    // O instante em que um crédito morreu: para CONSUMIDO, o `fim` do
    // atendimento que o consumiu; para EXPIRADO, o prazo que o matou.
    const fimPorAtendimento = await this.fimDosAtendimentos(
      itens.map((i) => i.atendimentoId).filter((id): id is string => id !== null),
    );

    const creditos: CreditoParaStatus[] = itens.map((i) => ({
      statusPagamentoDaVenda: StatusPagamento[i.venda.statusPagamento],
      statusDoItem: StatusItemPacote[i.status],
      deixouDeViverEm:
        i.status === 'CONSUMIDO'
          ? (i.atendimentoId ? fimPorAtendimento.get(i.atendimentoId) ?? null : null)
          : i.status === 'EXPIRADO'
            ? i.prazoReagendamentoAte
            : null,
    }));
    const paraStatus: AvulsoParaStatus[] = avulsos.map((a) => ({ criadoEm: a.criadoEm }));

    return statusDoClube({ creditos, avulsos: paraStatus });
  }

  private async fimDosAtendimentos(ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.atendimento.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, fim: true },
    });
    return new Map(rows.map((r) => [r.id, r.fim]));
  }
}
