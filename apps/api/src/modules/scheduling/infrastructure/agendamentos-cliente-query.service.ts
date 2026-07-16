import { Injectable } from '@nestjs/common';
import { AgendamentoClienteDTO, OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

/**
 * Read model dos próximos agendamentos de UM cliente (área logada). Só os
 * AGENDADOS futuros, do mais próximo ao mais distante. Projeção de leitura —
 * não é fonte de verdade (§2.1).
 */
@Injectable()
export class AgendamentosClienteQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async proximos(companyId: string, clienteId: string): Promise<AgendamentoClienteDTO[]> {
    const atendimentos = await this.prisma.atendimento.findMany({
      where: { companyId, clienteId, status: 'AGENDADO', inicio: { gte: new Date() } },
      include: { itens: true },
      orderBy: { inicio: 'asc' },
    });
    if (atendimentos.length === 0) return [];

    const [servicos, barbeiros] = await Promise.all([
      this.prisma.servico.findMany(),
      this.prisma.barbeiro.findMany({
        where: { id: { in: [...new Set(atendimentos.map((a) => a.barbeiroId))] } },
      }),
    ]);
    const servicoNome = new Map(servicos.map((s) => [s.id, s.nome]));
    const barbeiroNome = new Map(barbeiros.map((b) => [b.id, b.nome]));

    return atendimentos.map((a) => ({
      atendimentoId: a.id,
      inicioIso: a.inicio.toISOString(),
      servicoNomes: a.itens.map((i) => servicoNome.get(i.servicoId) ?? '?'),
      barbeiroNome: barbeiroNome.get(a.barbeiroId) ?? '?',
      origem: OrigemAtendimento[a.origem],
      status: StatusAtendimento[a.status],
    }));
  }
}
