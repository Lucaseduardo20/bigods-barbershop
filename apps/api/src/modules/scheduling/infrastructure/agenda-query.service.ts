import { Injectable } from '@nestjs/common';
import {
  AtendimentoDTO,
  FormaPagamento,
  OrigemAtendimento,
  StatusAtendimento,
  StatusPagamento,
} from '@bigods/contracts';
import {
  Atendimento as AtendimentoRow,
  Barbeiro as BarbeiroRow,
  Cliente as ClienteRow,
  IntencaoDePagamento as IntencaoRow,
  ItemAtendido as ItemAtendidoRow,
  ItemProdutoAtendido as ItemProdutoAtendidoRow,
} from '@prisma/client';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { limitesDoDiaCivil } from '../../../shared/domain/calendario';
import { Timezone } from '../../../shared/domain/timezone';

type AtendimentoComItens = AtendimentoRow & { itens: ItemAtendidoRow[]; produtos: ItemProdutoAtendidoRow[] };

/** Projeção de leitura da agenda (§2.1) — não é fonte de verdade de conflito. */
@Injectable()
export class AgendaQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `deLocal`/`ateLocal` são dias civis (YYYY-MM-DD) no fuso da empresa,
   * inclusivos nas duas pontas — "os atendimentos do período" são os que caem
   * nesses dias civis LOCAIS, não no dia UTC bruto do instante (um atendimento
   * às 23:30 local não pode "vazar" para o dia seguinte).
   */
  async listar(params: {
    companyId: string;
    deLocal: string;
    ateLocal: string;
    tz: Timezone;
    barbeiroId?: string;
  }): Promise<AtendimentoDTO[]> {
    const { inicio } = limitesDoDiaCivil(params.deLocal, params.tz);
    const { fimExclusivo } = limitesDoDiaCivil(params.ateLocal, params.tz);
    const atendimentos = await this.prisma.atendimento.findMany({
      where: {
        companyId: params.companyId,
        ...(params.barbeiroId ? { barbeiroId: params.barbeiroId } : {}),
        inicio: { lt: fimExclusivo },
        fim: { gt: inicio },
      },
      include: { itens: true, produtos: true },
      orderBy: { inicio: 'asc' },
    });
    return this.mapearTodos(atendimentos);
  }

  /** Um único atendimento por id — para o modal de detalhe (agenda e comissão). */
  async porId(id: string, companyId: string): Promise<AtendimentoDTO | null> {
    const atendimento = await this.prisma.atendimento.findFirst({
      where: { id, companyId },
      include: { itens: true, produtos: true },
    });
    if (!atendimento) return null;
    const dtos = await this.mapearTodos([atendimento]);
    return dtos[0] ?? null;
  }

  private async mapearTodos(atendimentos: AtendimentoComItens[]): Promise<AtendimentoDTO[]> {
    if (atendimentos.length === 0) return [];

    const barbeiroIds = new Set(atendimentos.map((a) => a.barbeiroId));
    for (const a of atendimentos) {
      if (a.origemLinkBarbeiroId) barbeiroIds.add(a.origemLinkBarbeiroId);
    }
    const [clientes, barbeiros, servicos, produtos, intencoes] = await Promise.all([
      this.prisma.cliente.findMany({
        where: { id: { in: [...new Set(atendimentos.map((a) => a.clienteId))] } },
      }),
      this.prisma.barbeiro.findMany({
        where: { id: { in: [...barbeiroIds] } },
      }),
      this.prisma.servico.findMany(),
      this.prisma.produto.findMany(),
      this.prisma.intencaoDePagamento.findMany({
        where: {
          referenciaTipo: 'ATENDIMENTO',
          atendimentoId: { in: atendimentos.map((a) => a.id) },
          status: 'PAGO',
        },
      }),
    ]);
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));
    const barbeiroPorId = new Map(barbeiros.map((b) => [b.id, b]));
    const servicoNomePorId = new Map(servicos.map((s) => [s.id, s.nome]));
    const produtoNomePorId = new Map(produtos.map((p) => [p.id, p.nome]));
    const intencaoPagaPorAtendimento = new Map(intencoes.map((i) => [i.atendimentoId!, i]));

    return atendimentos.map((a) =>
      this.paraDTO(
        a,
        clientePorId.get(a.clienteId),
        barbeiroPorId.get(a.barbeiroId),
        barbeiroPorId,
        servicoNomePorId,
        produtoNomePorId,
        intencaoPagaPorAtendimento.get(a.id),
      ),
    );
  }

  private paraDTO(
    a: AtendimentoComItens,
    cliente: ClienteRow | undefined,
    barbeiro: BarbeiroRow | undefined,
    barbeiroPorId: Map<string, BarbeiroRow>,
    servicoNomePorId: Map<string, string>,
    produtoNomePorId: Map<string, string>,
    intencaoPaga: IntencaoRow | undefined,
  ): AtendimentoDTO {
    const valorItens = a.itens.reduce((acc, i) => acc + i.valorCobradoCentavos, 0);
    const valorProdutos = a.produtos.reduce((acc, p) => acc + p.valorUnitarioCentavos * p.quantidade, 0);
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
        servicoNome: servicoNomePorId.get(i.servicoId) ?? '?',
        valorCobradoCentavos: i.valorCobradoCentavos,
        duracaoMinutos: i.duracaoMinutos,
        itemDoPacoteId: i.itemDoPacoteId,
      })),
      produtos: a.produtos.map((p) => ({
        produtoId: p.produtoId,
        produtoNome: produtoNomePorId.get(p.produtoId) ?? '?',
        quantidade: p.quantidade,
        valorUnitarioCentavos: p.valorUnitarioCentavos,
      })),
      inicio: a.inicio.toISOString(),
      fim: a.fim.toISOString(),
      status: StatusAtendimento[a.status],
      origem: OrigemAtendimento[a.origem],
      formaPagamento: a.formaPagamento ? FormaPagamento[a.formaPagamento] : null,
      motivoCancelamento: a.motivoCancelamento,
      valorTotalCentavos: valorItens + valorProdutos,
      pagoOnline: intencaoPaga !== undefined,
      valorPagoOnlineCentavos: intencaoPaga?.valorCentavos ?? 0,
      origemLinkBarbeiroId: a.origemLinkBarbeiroId,
      origemLinkBarbeiroNome: a.origemLinkBarbeiroId ? (barbeiroPorId.get(a.origemLinkBarbeiroId)?.nome ?? null) : null,
      valorAbatidoSaldoCentavos: a.valorAbatidoSaldoCentavos,
    };
  }
}
