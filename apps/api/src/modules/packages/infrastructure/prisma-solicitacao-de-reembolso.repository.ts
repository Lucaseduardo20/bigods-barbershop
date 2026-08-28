import { StatusSolicitacaoReembolso } from '@bigods/contracts';
import { SolicitacaoDeReembolso as SolicitacaoDeReembolsoPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId } from '../../../shared/domain/ids';
import { SolicitacaoDeReembolso, SolicitacaoDeReembolsoId } from '../domain/solicitacao-de-reembolso.aggregate';
import { SolicitacaoDeReembolsoRepository } from '../domain/solicitacao-de-reembolso.repository';

function paraDominio(row: SolicitacaoDeReembolsoPrisma): SolicitacaoDeReembolso {
  return SolicitacaoDeReembolso.reconstituir({
    id: row.id,
    companyId: row.companyId,
    vendaDePacoteId: row.vendaDePacoteId,
    clienteId: row.clienteId,
    valor: Dinheiro.deCentavos(row.valorCentavos),
    criadaEm: row.criadaEm,
    prazoLimiteEm: row.prazoLimiteEm,
    status: StatusSolicitacaoReembolso[row.status],
    reembolsadaEm: row.reembolsadaEm,
    agendadaPara: row.agendadaPara,
    executadaEm: row.executadaEm,
    gatewayRefundId: row.gatewayRefundId,
    tentativas: row.tentativas,
    ultimoErro: row.ultimoErro,
  });
}

export class PrismaSolicitacaoDeReembolsoRepository implements SolicitacaoDeReembolsoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: SolicitacaoDeReembolsoId): Promise<SolicitacaoDeReembolso | null> {
    const row = await this.db.solicitacaoDeReembolso.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async pendentes(companyId: CompanyId): Promise<SolicitacaoDeReembolso[]> {
    const rows = await this.db.solicitacaoDeReembolso.findMany({
      where: { companyId, status: 'PENDENTE' },
      orderBy: { criadaEm: 'asc' },
    });
    return rows.map(paraDominio);
  }

  async porStatus(
    companyId: CompanyId,
    status: StatusSolicitacaoReembolso,
  ): Promise<SolicitacaoDeReembolso[]> {
    const rows = await this.db.solicitacaoDeReembolso.findMany({
      where: { companyId, status },
      // AGENDADO ordena pelo prazo (o que sai primeiro aparece primeiro); os
      // outros pela criação, que é a fila de decisão do admin.
      orderBy:
        status === StatusSolicitacaoReembolso.AGENDADO
          ? { agendadaPara: 'asc' }
          : { criadaEm: 'asc' },
    });
    return rows.map(paraDominio);
  }

  async agendadosVencidos(agora: Date, limite: number): Promise<SolicitacaoDeReembolso[]> {
    const rows = await this.db.solicitacaoDeReembolso.findMany({
      // Casa com o índice `@@index([status, agendadaPara])` — sem ele isto é seq
      // scan numa tabela que só cresce.
      where: { status: 'AGENDADO', agendadaPara: { lte: agora } },
      orderBy: { agendadaPara: 'asc' },
      take: limite,
    });
    return rows.map(paraDominio);
  }

  async salvar(solicitacao: SolicitacaoDeReembolso): Promise<void> {
    const dados = {
      companyId: solicitacao.companyId,
      vendaDePacoteId: solicitacao.vendaDePacoteId,
      clienteId: solicitacao.clienteId,
      valorCentavos: solicitacao.valor.centavos,
      criadaEm: solicitacao.criadaEm,
      prazoLimiteEm: solicitacao.prazoLimiteEm,
      status: solicitacao.status,
      reembolsadaEm: solicitacao.reembolsadaEm,
      agendadaPara: solicitacao.agendadaPara,
      executadaEm: solicitacao.executadaEm,
      gatewayRefundId: solicitacao.gatewayRefundId,
      tentativas: solicitacao.tentativas,
      ultimoErro: solicitacao.ultimoErro,
    };
    await this.db.solicitacaoDeReembolso.upsert({
      where: { id: solicitacao.id },
      create: { id: solicitacao.id, ...dados },
      update: dados,
    });
  }
}
