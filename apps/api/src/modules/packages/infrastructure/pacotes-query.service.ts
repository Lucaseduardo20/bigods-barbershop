import { Injectable } from '@nestjs/common';
import { StatusItemPacote, StatusPagamento, VendaDePacoteDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

@Injectable()
export class PacotesQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(companyId: string, clienteId?: string): Promise<VendaDePacoteDTO[]> {
    const vendas = await this.prisma.vendaDePacote.findMany({
      where: { companyId, ...(clienteId ? { clienteId } : {}) },
      include: { itens: { orderBy: { id: 'asc' } } },
      orderBy: { compradoEm: 'desc' },
    });
    if (vendas.length === 0) return [];

    const barbeiroIds = new Set(vendas.map((v) => v.barbeiroId));
    for (const v of vendas) {
      if (v.origemLinkBarbeiroId) barbeiroIds.add(v.origemLinkBarbeiroId);
    }
    const [clientes, servicos, barbeiros] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { id: { in: [...new Set(vendas.map((v) => v.clienteId))] } },
      }),
      this.prisma.servico.findMany(),
      this.prisma.barbeiro.findMany({
        where: { id: { in: [...barbeiroIds] } },
      }),
    ]);
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
    const barbeiroPorId = new Map(barbeiros.map((b) => [b.id, b]));

    return vendas.map((v) => {
      const cliente = clientePorId.get(v.clienteId);
      return {
        id: v.id,
        cliente: {
          id: v.clienteId,
          nome: cliente?.nome ?? '?',
          telefone: cliente?.telefone ?? '',
        },
        barbeiroId: v.barbeiroId,
        barbeiroNome: barbeiroPorId.get(v.barbeiroId)?.nome ?? '?',
        valorPagoCentavos: v.valorPagoCentavos,
        saldoResidualCentavos: v.saldoResidualCentavos,
        compradoEm: v.compradoEm.toISOString(),
        statusPagamento: StatusPagamento[v.statusPagamento],
        origemLinkBarbeiroId: v.origemLinkBarbeiroId,
        origemLinkBarbeiroNome: v.origemLinkBarbeiroId ? (barbeiroPorId.get(v.origemLinkBarbeiroId)?.nome ?? null) : null,
        itens: v.itens.map((i) => ({
          id: i.id,
          servicoId: i.servicoId,
          servicoNome: servicoPorId.get(i.servicoId)?.nome ?? '?',
          valorRateadoCentavos: i.valorRateadoCentavos,
          status: StatusItemPacote[i.status],
          faltasComputadas: i.faltasComputadas,
          prazoReagendamentoAte: i.prazoReagendamentoAte?.toISOString() ?? null,
          atendimentoId: i.atendimentoId,
        })),
      };
    });
  }
}
