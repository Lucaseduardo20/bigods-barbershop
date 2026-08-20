import { Inject, Injectable } from '@nestjs/common';
import {
  SolicitacaoDeReembolsoDTO,
  StatusItemPacote,
  StatusPagamento,
  StatusSolicitacaoReembolso,
  VendaDePacoteDTO,
} from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { fimDoDiaCivilMaisDias } from '../../../shared/domain/calendario';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../domain/parametros-da-empresa.repository';
import { PRAZO_REEMBOLSO_DIAS } from '../domain/solicitacao-de-reembolso.aggregate';

@Injectable()
export class PacotesQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  /**
   * `barbeiroId` escopa a listagem (2026-08-18): barbeiro não-admin só enxerga
   * os pacotes comprados COM ELE — mesmo princípio da agenda e do extrato de
   * comissão. Pacote comprado sem barbeiro escolhido (`null`) não é de
   * ninguém em particular, então não aparece pra barbeiro nenhum: só o admin
   * vê e decide quem atende. `undefined` = sem escopo (admin vê tudo).
   */
  async listar(companyId: string, clienteId?: string, barbeiroId?: string): Promise<VendaDePacoteDTO[]> {
    const vendas = await this.prisma.vendaDePacote.findMany({
      where: { companyId, ...(clienteId ? { clienteId } : {}), ...(barbeiroId ? { barbeiroId } : {}) },
      include: { itens: { orderBy: { id: 'asc' } } },
      orderBy: { compradoEm: 'desc' },
    });
    if (vendas.length === 0) return [];

    const tz = await this.parametros.timezone(companyId);
    // `barbeiroId` da venda é nulável desde 2026-08-18 (compra sem escolher).
    const barbeiroIds = new Set(vendas.map((v) => v.barbeiroId).filter((id): id is string => !!id));
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
        // null = comprou sem escolher barbeiro: qualquer um atende (2026-08-18).
        barbeiroId: v.barbeiroId,
        barbeiroNome: v.barbeiroId ? barbeiroPorId.get(v.barbeiroId)?.nome ?? '?' : null,
        valorPagoCentavos: v.valorPagoCentavos,
        saldoResidualCentavos: v.saldoResidualCentavos,
        saldoUtilizadoCentavos: v.saldoUtilizadoCentavos,
        saldoReservadoReembolsoCentavos: v.saldoReservadoReembolsoCentavos,
        saldoReembolsadoCentavos: v.saldoReembolsadoCentavos,
        // FASE 4b (§8.7): só existe prazo pra pedir reembolso enquanto houver saldo
        // residual disponível — uma vez zerado (usado ou já reservado), não faz
        // sentido mostrar prazo nenhum.
        prazoReembolsoAte:
          v.saldoResidualCentavos > 0
            ? fimDoDiaCivilMaisDias(v.saldoResidualDesde ?? v.compradoEm, PRAZO_REEMBOLSO_DIAS, tz).toISOString()
            : null,
        compradoEm: v.compradoEm.toISOString(),
        statusPagamento: StatusPagamento[v.statusPagamento],
        origemLinkBarbeiroId: v.origemLinkBarbeiroId,
        origemLinkBarbeiroNome: v.origemLinkBarbeiroId ? (barbeiroPorId.get(v.origemLinkBarbeiroId)?.nome ?? null) : null,
        itens: v.itens.map((i) => ({
          id: i.id,
          servicoId: i.servicoId,
          servicoNome: servicoPorId.get(i.servicoId)?.nome ?? '?',
          servicoDuracaoMinutos: servicoPorId.get(i.servicoId)?.duracaoMinutos ?? 0,
          valorRateadoCentavos: i.valorRateadoCentavos,
          status: StatusItemPacote[i.status],
          faltasComputadas: i.faltasComputadas,
          prazoReagendamentoAte: i.prazoReagendamentoAte?.toISOString() ?? null,
          atendimentoId: i.atendimentoId,
        })),
      };
    });
  }

  /**
   * FASE 4b (sessão-E, §8.7): fila de pedidos de reembolso manual pendentes,
   * pro admin decidir devolver por fora (PIX) e confirmar.
   */
  async reembolsosPendentes(companyId: string): Promise<SolicitacaoDeReembolsoDTO[]> {
    const solicitacoes = await this.prisma.solicitacaoDeReembolso.findMany({
      where: { companyId, status: 'PENDENTE' },
      orderBy: { criadaEm: 'asc' },
    });
    if (solicitacoes.length === 0) return [];

    const clientes = await this.prisma.cliente.findMany({
      where: { id: { in: [...new Set(solicitacoes.map((s) => s.clienteId))] } },
    });
    const clientePorId = new Map(clientes.map((c) => [c.id, c]));

    return solicitacoes.map((s) => ({
      id: s.id,
      vendaDePacoteId: s.vendaDePacoteId,
      cliente: {
        id: s.clienteId,
        nome: clientePorId.get(s.clienteId)?.nome ?? '?',
        telefone: clientePorId.get(s.clienteId)?.telefone ?? '',
      },
      valorCentavos: s.valorCentavos,
      criadaEm: s.criadaEm.toISOString(),
      prazoLimiteEm: s.prazoLimiteEm.toISOString(),
      status: StatusSolicitacaoReembolso[s.status],
      reembolsadaEm: s.reembolsadaEm?.toISOString() ?? null,
    }));
  }
}
