import { Injectable } from '@nestjs/common';
import {
  AtendimentoDTO,
  FormaPagamento,
  OrigemAtendimento,
  StatusAtendimento,
} from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { limitesDoDiaCivil } from '../../../shared/domain/calendario';
import { Timezone } from '../../../shared/domain/timezone';

/** Projeção de leitura da agenda (§2.1) — não é fonte de verdade de conflito. */
@Injectable()
export class AgendaQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `diaLocal` é o dia civil (YYYY-MM-DD) no fuso da empresa — "os atendimentos
   * de hoje" são os que caem nesse dia civil LOCAL, não no dia UTC bruto do
   * instante (um atendimento às 23:30 local não pode "vazar" para o dia seguinte).
   */
  async listar(params: {
    companyId: string;
    diaLocal: string;
    tz: Timezone;
    barbeiroId?: string;
  }): Promise<AtendimentoDTO[]> {
    const { inicio, fimExclusivo } = limitesDoDiaCivil(params.diaLocal, params.tz);
    const atendimentos = await this.prisma.atendimento.findMany({
      where: {
        companyId: params.companyId,
        ...(params.barbeiroId ? { barbeiroId: params.barbeiroId } : {}),
        inicio: { lt: fimExclusivo },
        fim: { gt: inicio },
      },
      include: { itens: true },
      orderBy: { inicio: 'asc' },
    });
    if (atendimentos.length === 0) return [];

    const [clientes, barbeiros, servicos] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { id: { in: [...new Set(atendimentos.map((a) => a.clienteId))] } },
      }),
      this.prisma.barbeiro.findMany({
        where: { id: { in: [...new Set(atendimentos.map((a) => a.barbeiroId))] } },
      }),
      this.prisma.servico.findMany(),
    ]);
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    const barbeiroPorId = new Map(barbeiros.map((b) => [b.id, b]));
    const servicoPorId = new Map(servicos.map((s) => [s.id, s]));

    return atendimentos.map((a) => {
      const cliente = clientePorId.get(a.clienteId);
      const barbeiro = barbeiroPorId.get(a.barbeiroId);
      return {
        id: a.id,
        cliente: {
          id: a.clienteId,
          nome: cliente?.nome ?? '?',
          telefone: cliente?.telefone ?? '',
        },
        barbeiro: { id: a.barbeiroId, nome: barbeiro?.nome ?? '?' },
        itens: a.itens.map((i) => ({
          servicoId: i.servicoId,
          servicoNome: servicoPorId.get(i.servicoId)?.nome ?? '?',
          valorCobradoCentavos: i.valorCobradoCentavos,
          duracaoMinutos: i.duracaoMinutos,
          itemDoPacoteId: i.itemDoPacoteId,
        })),
        inicio: a.inicio.toISOString(),
        fim: a.fim.toISOString(),
        status: StatusAtendimento[a.status],
        origem: OrigemAtendimento[a.origem],
        formaPagamento: a.formaPagamento ? FormaPagamento[a.formaPagamento] : null,
        motivoCancelamento: a.motivoCancelamento,
        valorTotalCentavos: a.itens.reduce((acc, i) => acc + i.valorCobradoCentavos, 0),
      };
    });
  }
}
