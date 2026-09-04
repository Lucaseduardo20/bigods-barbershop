import { StatusPagamento } from '@bigods/contracts';
import { TentativaDePagamento as TentativaPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { IntencaoDePagamentoId } from '../../../shared/domain/ids';
import {
  MeioDePagamentoOnline,
  TentativaDePagamento,
} from '../domain/tentativa-de-pagamento.aggregate';
import { TentativaDePagamentoRepository } from '../domain/tentativa-de-pagamento.repository';
import { ProvedorDePagamento } from '../domain/provedor-de-pagamento';

function paraDominio(row: TentativaPrisma): TentativaDePagamento {
  return TentativaDePagamento.reconstituir({
    id: row.id,
    companyId: row.companyId,
    intencaoDePagamentoId: row.intencaoDePagamentoId,
    // Mapeamento EXPLÍCITO Prisma → domínio: o enum do ORM não vaza para o
    // agregado, que usa uniões de literais.
    gateway: row.gateway as ProvedorDePagamento,
    gatewayId: row.gatewayId,
    idempotencyKey: row.idempotencyKey,
    meio: row.meio as MeioDePagamentoOnline,
    status: StatusPagamento[row.status],
    statusDetalhe: row.statusDetalhe,
    valorLiquido:
      row.valorLiquidoCentavos === null ? null : Dinheiro.deCentavos(row.valorLiquidoCentavos),
    criadaEm: row.criadaEm,
    atualizadaEm: row.atualizadaEm,
  });
}

export class PrismaTentativaDePagamentoRepository implements TentativaDePagamentoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: string): Promise<TentativaDePagamento | null> {
    const row = await this.db.tentativaDePagamento.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porIntencao(intencaoId: IntencaoDePagamentoId): Promise<TentativaDePagamento[]> {
    const rows = await this.db.tentativaDePagamento.findMany({
      where: { intencaoDePagamentoId: intencaoId },
      orderBy: { criadaEm: 'desc' },
    });
    return rows.map(paraDominio);
  }

  async salvar(tentativa: TentativaDePagamento): Promise<void> {
    const dados = {
      companyId: tentativa.companyId,
      intencaoDePagamentoId: tentativa.intencaoDePagamentoId,
      gateway: tentativa.gateway,
      gatewayId: tentativa.gatewayId,
      idempotencyKey: tentativa.idempotencyKey,
      meio: tentativa.meio,
      status: tentativa.status,
      statusDetalhe: tentativa.statusDetalhe,
      valorLiquidoCentavos: tentativa.valorLiquido?.centavos ?? null,
      criadaEm: tentativa.criadaEm,
      atualizadaEm: tentativa.atualizadaEm,
    };
    await this.db.tentativaDePagamento.upsert({
      where: { id: tentativa.id },
      create: { id: tentativa.id, ...dados },
      update: dados,
    });
  }
}
