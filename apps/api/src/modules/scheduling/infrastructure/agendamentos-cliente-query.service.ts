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
      // CONCLUSAO_PENDENTE conta como próximo (2026-08-20): para o cliente o
      // atendimento não aconteceu — a aprovação do admin é assunto interno, e
      // sumir da lista antes da hora deixaria o cliente sem seu agendamento.
      where: {
        companyId,
        clienteId,
        status: { in: ['AGENDADO', 'CONCLUSAO_PENDENTE'] },
        inicio: { gte: new Date() },
      },
      include: { itens: true },
      orderBy: { inicio: 'asc' },
    });
    return this.mapear(atendimentos);
  }

  /**
   * FASE 1 (sessão-E): histórico do cliente — tudo que NÃO está mais
   * AGENDADO (concluído, cancelado, faltou), do mais recente ao mais
   * antigo. Leitura pura — projeção de leitura (§2.1), reusa o mesmo mapeamento
   * de `proximos`.
   */
  async historico(companyId: string, clienteId: string): Promise<AgendamentoClienteDTO[]> {
    const atendimentos = await this.prisma.atendimento.findMany({
      where: { companyId, clienteId, status: { notIn: ['AGENDADO', 'CONCLUSAO_PENDENTE'] } },
      include: { itens: true },
      orderBy: { inicio: 'desc' },
    });
    return this.mapear(atendimentos);
  }

  private async mapear(
    atendimentos: Array<{ id: string; inicio: Date; barbeiroId: string; origem: string; status: string; itens: { servicoId: string }[] }>,
  ): Promise<AgendamentoClienteDTO[]> {
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
      origem: OrigemAtendimento[a.origem as keyof typeof OrigemAtendimento],
      status: StatusAtendimento[a.status as keyof typeof StatusAtendimento],
    }));
  }
}
