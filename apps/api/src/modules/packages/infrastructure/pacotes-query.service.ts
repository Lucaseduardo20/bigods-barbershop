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

    const [clientes, servicos] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { id: { in: [...new Set(vendas.map((v) => v.clienteId))] } },
      }),
      this.prisma.servico.findMany(),
    ]);
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    const servicoPorId = new Map(servicos.map((s) => [s.id, s]));

    return vendas.map((v) => {
      const cliente = clientePorId.get(v.clienteId);
      return {
        id: v.id,
        cliente: {
          id: v.clienteId,
          nome: cliente?.nome ?? '?',
          telefone: cliente?.telefone ?? '',
        },
        valorPagoCentavos: v.valorPagoCentavos,
        saldoResidualCentavos: v.saldoResidualCentavos,
        compradoEm: v.compradoEm.toISOString(),
        statusPagamento: StatusPagamento[v.statusPagamento],
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
