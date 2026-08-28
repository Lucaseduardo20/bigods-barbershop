import { Injectable } from '@nestjs/common';
import {
  HomeAgendamentoDTO,
  HomeGestaoDTO,
  HomeLancamentoDTO,
  HomePendenciaDTO,
  HomePessoalDTO,
  StatusAtendimento,
  TipoLancamento,
} from '@bigods/contracts';
import { motivoOperacionalDoEstorno, rotuloDoMotivoDeEstorno } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { Timezone } from '../../../shared/domain/timezone';
import { diaCivilChave, limitesDoDiaCivil } from '../../../shared/domain/calendario';
import { ComissaoQueryService } from './comissao-query.service';
import { ticketMedioCentavos } from '../domain/ticket-medio';

/**
 * Home do admin (2026-08-19) — projeção de LEITURA, nada mais.
 *
 * A regra que rege este arquivo: **nenhum número daqui pode divergir da seção
 * detalhada correspondente**. Por isso o saldo vem do `ComissaoQueryService`
 * (a mesma função que o Financeiro usa), e não de um `groupBy` novo escrito
 * aqui — duas somas do mesmo dinheiro em dois lugares é como elas começam a
 * divergir.
 *
 * A única coisa CALCULADA é o ticket médio, e a conta mora em
 * `domain/ticket-medio.ts`, testada sozinha.
 *
 * ## Faturamento — de quais registros soma
 *
 * "Quanto entrou" no período = duas fontes, sem sobreposição:
 *
 * 1. **Atendimentos CONCLUÍDOS no período** — soma de `ItemAtendido.valorCobrado`
 *    + `ItemProdutoAtendido.valorUnitario × quantidade`. Valores CONGELADOS no
 *    atendimento (§3.5); nunca relidos do catálogo de hoje.
 * 2. **Vendas avulsas de produto no período** — quem entrou só pra comprar.
 *
 * **Venda de PACOTE não entra aqui.** O dinheiro do pacote aparece quando o
 * crédito é consumido, no atendimento — contar também na venda seria somar o
 * mesmo dinheiro duas vezes. A consequência é conhecida e aceita: o dia em que
 * a barbearia vende muito pacote mostra faturamento baixo, e os dias seguintes
 * mostram alto conforme os créditos são usados. Ver DECISOES_PENDENTES.
 */
@Injectable()
export class HomeQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comissao: ComissaoQueryService,
  ) {}

  async pessoal(barbeiroId: string, agora: Date): Promise<HomePessoalDTO> {
    const barbeiro = await this.prisma.barbeiro.findUniqueOrThrow({ where: { id: barbeiroId } });

    const [proximos, saldo, comissoes, pagamentos] = await Promise.all([
      this.prisma.atendimento.findMany({
        where: {
          barbeiroId,
          status: { in: ['AGENDADO', 'CONCLUSAO_PENDENTE'] },
          inicio: { gte: agora },
        },
        orderBy: { inicio: 'asc' },
        take: 2,
        include: { itens: true, produtos: true },
      }),
      // ★ A MESMA fonte do Financeiro. Não somar de novo aqui.
      this.comissao.saldo(barbeiroId),
      this.prisma.lancamentoComissao.findMany({
        where: { barbeiroId, tipo: 'COMISSAO' },
        orderBy: { ocorridoEm: 'desc' },
        take: 2,
      }),
      this.prisma.lancamentoComissao.findMany({
        where: { barbeiroId, tipo: 'PAGAMENTO' },
        orderBy: { ocorridoEm: 'desc' },
        take: 2,
      }),
    ]);

    const nomes = await this.nomesDeApoio(
      proximos.map((a) => a.clienteId),
      [...comissoes, ...pagamentos],
    );

    return {
      barbeiroId,
      nome: barbeiro.nome,
      fotoUrl: barbeiro.fotoUrl,
      proximosAgendamentos: proximos.map((a) =>
        this.paraAgendamento(a, nomes.clientes.get(a.clienteId) ?? '—', barbeiro.nome, nomes.servicos),
      ),
      saldoRealCentavos: saldo.saldoRealCentavos,
      ultimasComissoes: comissoes.map((l) => this.paraLancamento(l, nomes)),
      ultimosPagamentos: pagamentos.map((l) => this.paraLancamento(l, nomes)),
    };
  }

  async gestao(companyId: string, barbeiroId: string, tz: Timezone, agora: Date): Promise<HomeGestaoDTO> {
    const admin = await this.prisma.barbeiro.findUniqueOrThrow({ where: { id: barbeiroId } });
    const hoje = diaCivilChave(agora, tz);
    const { inicio: inicioDoDia, fimExclusivo: fimDoDia } = limitesDoDiaCivil(hoje, tz);
    const { inicio: inicioDoMes, fimExclusivo: fimDoMes } = this.limitesDoMes(hoje, tz);

    const [agendamentos, concluidosHoje, faturamentoHoje, mes, pendencias] = await Promise.all([
      this.prisma.atendimento.findMany({
        where: { companyId, inicio: { gte: inicioDoDia, lt: fimDoDia } },
        orderBy: { inicio: 'asc' },
        include: { itens: true, produtos: true },
      }),
      this.prisma.atendimento.count({
        where: { companyId, status: 'CONCLUIDO', inicio: { gte: inicioDoDia, lt: fimDoDia } },
      }),
      this.faturamento(companyId, inicioDoDia, fimDoDia),
      this.faturamentoEConcluidos(companyId, inicioDoMes, fimDoMes),
      this.pendencias(companyId),
    ]);

    const nomes = await this.nomesDeApoio(agendamentos.map((a) => a.clienteId), []);
    const barbeiros = await this.prisma.barbeiro.findMany({
      where: { id: { in: [...new Set(agendamentos.map((a) => a.barbeiroId))] } },
      select: { id: true, nome: true },
    });
    const nomeBarbeiro = new Map(barbeiros.map((b) => [b.id, b.nome]));

    return {
      nome: admin.nome,
      fotoUrl: admin.fotoUrl,
      hoje,
      // Só os 3 primeiros na home; o "ver tudo" leva pra Agenda completa.
      agendamentosDeHoje: agendamentos
        .slice(0, 3)
        .map((a) =>
          this.paraAgendamento(
            a,
            nomes.clientes.get(a.clienteId) ?? '—',
            nomeBarbeiro.get(a.barbeiroId) ?? '—',
            nomes.servicos,
          ),
        ),
      totalAgendamentosDeHoje: agendamentos.length,
      faturamentoDeHojeCentavos: faturamentoHoje,
      concluidosHoje,
      pendencias,
      ticketMedioCentavos: ticketMedioCentavos(mes.faturamento, mes.concluidos),
      mesDoTicket: hoje.slice(0, 7),
    };
  }

  /** Soma o faturamento do período — ver o docblock da classe. */
  private async faturamento(companyId: string, inicio: Date, fimExclusivo: Date): Promise<number> {
    return (await this.faturamentoEConcluidos(companyId, inicio, fimExclusivo)).faturamento;
  }

  private async faturamentoEConcluidos(
    companyId: string,
    inicio: Date,
    fimExclusivo: Date,
  ): Promise<{ faturamento: number; concluidos: number }> {
    const [atendimentos, vendasAvulsas] = await Promise.all([
      this.prisma.atendimento.findMany({
        where: { companyId, status: 'CONCLUIDO', inicio: { gte: inicio, lt: fimExclusivo } },
        include: { itens: true, produtos: true },
      }),
      this.prisma.itemVendaDeProduto.findMany({
        where: { venda: { companyId, vendidoEm: { gte: inicio, lt: fimExclusivo } } },
      }),
    ]);

    const dosAtendimentos = atendimentos.reduce((total, a) => total + this.valorDoAtendimento(a), 0);
    const dasVendas = vendasAvulsas.reduce((t, i) => t + i.valorUnitarioCentavos * i.quantidade, 0);

    return { faturamento: dosAtendimentos + dasVendas, concluidos: atendimentos.length };
  }

  /** Serviços + produtos do atendimento, pelo valor CONGELADO nele (§3.5). */
  private valorDoAtendimento(a: {
    itens: { valorCobradoCentavos: number }[];
    produtos: { valorUnitarioCentavos: number; quantidade: number }[];
  }): number {
    return (
      a.itens.reduce((t, i) => t + i.valorCobradoCentavos, 0) +
      a.produtos.reduce((t, p) => t + p.valorUnitarioCentavos * p.quantidade, 0)
    );
  }

  /**
   * O que espera decisão do admin: pacote comprado e ainda não confirmado,
   * atendimento com pagamento online pendente (RESERVADO) e conclusão
   * antecipada aguardando aprovação (2026-08-20).
   *
   * A conclusão antecipada entra aqui porque, se o admin não a vê, a trava não
   * protege nada — só trava: o barbeiro fica sem a comissão e ninguém sabe que
   * há algo pra decidir.
   */
  private async pendencias(companyId: string): Promise<HomePendenciaDTO[]> {
    const [pacotes, atendimentos, conclusoes, estornosFalhados] = await Promise.all([
      this.prisma.vendaDePacote.findMany({
        where: { companyId, statusPagamento: 'AGUARDANDO' },
        orderBy: { compradoEm: 'desc' },
        take: 5,
      }),
      this.prisma.atendimento.findMany({
        where: { companyId, status: 'RESERVADO' },
        orderBy: { inicio: 'asc' },
        include: { itens: true, produtos: true },
        take: 5,
      }),
      this.prisma.atendimento.findMany({
        where: { companyId, status: 'CONCLUSAO_PENDENTE' },
        orderBy: { conclusaoSolicitadaEm: 'asc' },
        include: { itens: true, produtos: true },
        take: 5,
      }),
      // Estornos que esgotaram as tentativas (2026-08-27). Ordenados do mais
      // ANTIGO primeiro — ao contrário dos pacotes, aqui o que envelhece é
      // dinheiro do cliente que não voltou, e o mais velho é o mais urgente.
      this.prisma.solicitacaoDeReembolso.findMany({
        where: { companyId, status: 'FALHOU' },
        orderBy: { agendadaPara: 'asc' },
        take: 5,
      }),
    ]);

    const clienteIds = [
      ...new Set([
        ...pacotes.map((p) => p.clienteId),
        ...atendimentos.map((a) => a.clienteId),
        ...conclusoes.map((a) => a.clienteId),
        ...estornosFalhados.map((e) => e.clienteId),
      ]),
    ];
    const [clientes, barbeiros] = await Promise.all([
      this.prisma.cliente.findMany({ where: { id: { in: clienteIds } } }),
      this.prisma.barbeiro.findMany({
        where: { id: { in: [...new Set(conclusoes.map((a) => a.barbeiroId))] } },
        select: { id: true, nome: true },
      }),
    ]);
    const nome = new Map(clientes.map((c) => [c.id, c.nome]));
    const nomeBarbeiro = new Map(barbeiros.map((b) => [b.id, b.nome]));

    return [
      ...pacotes.map(
        (p): HomePendenciaDTO => ({
          tipo: 'PACOTE_AGUARDANDO',
          id: p.id,
          clienteNome: nome.get(p.clienteId) ?? '—',
          valorCentavos: p.valorPagoCentavos,
          desde: p.compradoEm.toISOString(),
        }),
      ),
      ...atendimentos.map(
        (a): HomePendenciaDTO => ({
          tipo: 'ATENDIMENTO_AGUARDANDO_PAGAMENTO',
          id: a.id,
          clienteNome: nome.get(a.clienteId) ?? '—',
          valorCentavos: this.valorDoAtendimento(a),
          desde: a.inicio.toISOString(),
        }),
      ),
      ...conclusoes.map(
        (a): HomePendenciaDTO => ({
          tipo: 'CONCLUSAO_ANTECIPADA',
          id: a.id,
          clienteNome: nome.get(a.clienteId) ?? '—',
          valorCentavos: this.valorDoAtendimento(a),
          // `desde` = quando o barbeiro pediu, não o horário do atendimento:
          // o que envelhece aqui é a decisão pendente do admin.
          desde: (a.conclusaoSolicitadaEm ?? a.inicio).toISOString(),
          barbeiroNome: nomeBarbeiro.get(a.barbeiroId) ?? '—',
          motivo: a.conclusaoAntecipadaMotivo ?? '',
        }),
      ),
      ...estornosFalhados.map(
        (e): HomePendenciaDTO => ({
          tipo: 'ESTORNO_FALHADO',
          id: e.id,
          clienteNome: nome.get(e.clienteId) ?? '—',
          valorCentavos: e.valorCentavos,
          // `desde` = quando a última execução deveria ter acontecido. É o que
          // envelhece: dinheiro do cliente parado desde então.
          desde: (e.agendadaPara ?? e.criadaEm).toISOString(),
          // Motivo em linguagem de OPERAÇÃO, nunca o erro cru do gateway — que é
          // longo, em inglês, e não cabe numa linha de home. O cru fica na tela
          // de reembolsos, que é onde alguém vai investigar.
          motivo: rotuloDoMotivoDeEstorno(motivoOperacionalDoEstorno(e.ultimoErro)),
        }),
      ),
    ];
  }

  /** Primeiro e último instante do mês civil LOCAL a que `diaISO` pertence. */
  private limitesDoMes(diaISO: string, tz: Timezone): { inicio: Date; fimExclusivo: Date } {
    const [ano, mes] = diaISO.split('-').map(Number) as [number, number, number];
    const primeiroDia = `${diaISO.slice(0, 7)}-01`;
    const proximoMes = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
    return {
      inicio: limitesDoDiaCivil(primeiroDia, tz).inicio,
      fimExclusivo: limitesDoDiaCivil(proximoMes, tz).inicio,
    };
  }

  private async nomesDeApoio(
    clienteIds: string[],
    lancamentos: { servicoId: string | null; produtoId: string | null; registradoPorId: string | null }[],
  ) {
    const [clientes, servicos, produtos, registradores] = await Promise.all([
      this.prisma.cliente.findMany({ where: { id: { in: [...new Set(clienteIds)] } } }),
      this.prisma.servico.findMany(),
      this.prisma.produto.findMany(),
      this.prisma.barbeiro.findMany({
        where: {
          id: { in: [...new Set(lancamentos.map((l) => l.registradoPorId).filter((x): x is string => !!x))] },
        },
        select: { id: true, nome: true },
      }),
    ]);
    return {
      clientes: new Map(clientes.map((c) => [c.id, c.nome])),
      servicos: new Map(servicos.map((s) => [s.id, s.nome])),
      produtos: new Map(produtos.map((p) => [p.id, p.nome])),
      registradores: new Map(registradores.map((b) => [b.id, b.nome])),
    };
  }

  private paraAgendamento(
    a: {
      id: string;
      inicio: Date;
      status: string;
      itens: { servicoId: string; valorCobradoCentavos: number }[];
      produtos: { valorUnitarioCentavos: number; quantidade: number }[];
    },
    clienteNome: string,
    barbeiroNome: string,
    servicos: Map<string, string>,
  ): HomeAgendamentoDTO {
    return {
      atendimentoId: a.id,
      inicio: a.inicio.toISOString(),
      clienteNome,
      barbeiroNome,
      servicos: a.itens.map((i) => servicos.get(i.servicoId) ?? '?').join(' + ') || '—',
      valorTotalCentavos: this.valorDoAtendimento(a),
      status: StatusAtendimento[a.status as keyof typeof StatusAtendimento],
    };
  }

  private paraLancamento(
    l: {
      id: string;
      tipo: string;
      ocorridoEm: Date;
      valorComissaoCentavos: number;
      servicoId: string | null;
      produtoId: string | null;
      registradoPorId: string | null;
    },
    nomes: {
      servicos: Map<string, string>;
      produtos: Map<string, string>;
      registradores: Map<string, string>;
    },
  ): HomeLancamentoDTO {
    const descricao =
      (l.servicoId ? nomes.servicos.get(l.servicoId) : null) ??
      (l.produtoId ? nomes.produtos.get(l.produtoId) : null) ??
      (l.registradoPorId ? `registrado por ${nomes.registradores.get(l.registradoPorId) ?? '—'}` : null) ??
      '—';
    return {
      id: l.id,
      tipo: TipoLancamento[l.tipo as keyof typeof TipoLancamento],
      ocorridoEm: l.ocorridoEm.toISOString(),
      valorCentavos: l.valorComissaoCentavos,
      descricao,
    };
  }
}
