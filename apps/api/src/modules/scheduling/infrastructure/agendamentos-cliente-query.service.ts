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
    const agora = new Date();
    const atendimentos = await this.prisma.atendimento.findMany({
      // Três estados são "ainda vai acontecer" para o cliente:
      //
      // - AGENDADO: firme.
      // - CONCLUSAO_PENDENTE (2026-08-20): o barbeiro concluiu antes da hora e
      //   espera aprovação. Assunto interno — sumir da lista deixaria o cliente
      //   sem o agendamento dele.
      // - RESERVADO (go-live 2026-08-20): avulso ONLINE nasce assim e só vira
      //   firme quando o pagamento confirma. Com o pagamento manual por
      //   WhatsApp esse intervalo passou a durar MINUTOS OU HORAS (alguém
      //   precisa olhar o WhatsApp e confirmar), e neste meio-tempo o cliente
      //   via sua reserva no HISTÓRICO — um agendamento futuro listado como
      //   coisa passada. É o bug que fez os avulsos "não aparecerem".
      //
      //   Só conta enquanto o prazo da reserva não venceu, mesmo que ninguém
      //   tenha lazy-expirado o registro ainda — mesmo critério da projeção de
      //   horários livres (`horarios-disponiveis-query.service.ts`).
      where: {
        companyId,
        clienteId,
        inicio: { gte: agora },
        OR: [
          { status: { in: ['AGENDADO', 'CONCLUSAO_PENDENTE'] } },
          { status: 'RESERVADO', reservaOnlineExpiraEm: { gt: agora } },
        ],
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
      // O espelho de `proximos`: o que ainda vai acontecer não é histórico.
      // RESERVADO sai daqui junto — uma reserva esperando pagamento é futuro,
      // não passado. Reserva que VENCEU virou RESERVA_EXPIRADA e continua no
      // histórico do banco (nada é apagado), só não é exibida pelo app.
      where: {
        companyId,
        clienteId,
        status: { notIn: ['AGENDADO', 'CONCLUSAO_PENDENTE', 'RESERVADO'] },
      },
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
