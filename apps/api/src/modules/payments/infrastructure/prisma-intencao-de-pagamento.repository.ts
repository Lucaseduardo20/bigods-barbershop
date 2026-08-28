import { StatusPagamento } from '@bigods/contracts';
import type { MeioDePagamentoOnline } from '@bigods/contracts';
import { IntencaoDePagamento as IntencaoPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import {
  IntencaoDePagamento,
  ReferenciaDePagamento,
} from '../domain/intencao-de-pagamento.aggregate';
import { IntencaoDePagamentoRepository } from '../domain/intencao-de-pagamento.repository';
import { ProvedorDePagamento } from '../domain/provedor-de-pagamento';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { AtendimentoId, IntencaoDePagamentoId, VendaDePacoteId } from '../../../shared/domain/ids';

function paraDominio(row: IntencaoPrisma): IntencaoDePagamento {
  const referencia: ReferenciaDePagamento =
    row.referenciaTipo === 'ATENDIMENTO'
      ? { tipo: 'ATENDIMENTO', atendimentoId: row.atendimentoId! }
      : { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: row.vendaDePacoteId! };
  return IntencaoDePagamento.reconstituir({
    id: row.id,
    companyId: row.companyId,
    referencia,
    valor: Dinheiro.deCentavos(row.valorCentavos),
    status: StatusPagamento[row.status],
    externalId: row.externalId,
    expiraEm: row.expiraEm,
    // Prisma → domínio, explícito: o enum do ORM não vaza para o agregado, que
    // usa a união de literais de `provedor-de-pagamento.ts`.
    gateway: row.gateway === null ? null : (row.gateway as ProvedorDePagamento),
    gatewayId: row.gatewayId,
    statusDetalhe: row.statusDetalhe,
    valorLiquido:
      row.valorLiquidoCentavos === null ? null : Dinheiro.deCentavos(row.valorLiquidoCentavos),
    meio: row.meio === null ? null : (row.meio as MeioDePagamentoOnline),
    estornoSolicitadoEm: row.estornoSolicitadoEm,
    estornoGatewayId: row.estornoGatewayId,
    estornoErro: row.estornoErro,
  });
}

export class PrismaIntencaoDePagamentoRepository implements IntencaoDePagamentoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: IntencaoDePagamentoId): Promise<IntencaoDePagamento | null> {
    const row = await this.db.intencaoDePagamento.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porExternalId(externalId: string): Promise<IntencaoDePagamento | null> {
    const row = await this.db.intencaoDePagamento.findUnique({ where: { externalId } });
    return row ? paraDominio(row) : null;
  }

  async porReferenciaAtendimento(atendimentoId: AtendimentoId): Promise<IntencaoDePagamento | null> {
    const row = await this.db.intencaoDePagamento.findFirst({
      where: { referenciaTipo: 'ATENDIMENTO', atendimentoId },
    });
    return row ? paraDominio(row) : null;
  }

  async porReferenciaVendaDePacote(vendaDePacoteId: VendaDePacoteId): Promise<IntencaoDePagamento | null> {
    const row = await this.db.intencaoDePagamento.findFirst({
      where: { referenciaTipo: 'VENDA_DE_PACOTE', vendaDePacoteId },
    });
    return row ? paraDominio(row) : null;
  }

  async porGatewayId(gatewayId: string): Promise<IntencaoDePagamento | null> {
    const row = await this.db.intencaoDePagamento.findFirst({ where: { gatewayId } });
    return row ? paraDominio(row) : null;
  }

  async comEstornoEmVoo(limite: number): Promise<IntencaoDePagamento[]> {
    const rows = await this.db.intencaoDePagamento.findMany({
      where: { estornoSolicitadoEm: { not: null }, estornoGatewayId: null },
      orderBy: { estornoSolicitadoEm: 'asc' },
      take: limite,
    });
    return rows.map(paraDominio);
  }

  async salvar(intencao: IntencaoDePagamento): Promise<void> {
    const { referencia } = intencao;
    const dados = {
      companyId: intencao.companyId,
      referenciaTipo: referencia.tipo,
      atendimentoId: referencia.tipo === 'ATENDIMENTO' ? referencia.atendimentoId : null,
      vendaDePacoteId: referencia.tipo === 'VENDA_DE_PACOTE' ? referencia.vendaDePacoteId : null,
      valorCentavos: intencao.valor.centavos,
      status: intencao.status,
      externalId: intencao.externalId,
      expiraEm: intencao.expiraEm,
      // Campos do Mercado Pago (2026-08-27). Escritos SEMPRE, inclusive como
      // null: esquecê-los aqui faria o agregado gravar em memória e o banco
      // ignorar em silêncio — o tipo de bug que só aparece no primeiro webhook.
      gateway: intencao.gateway,
      gatewayId: intencao.gatewayId,
      statusDetalhe: intencao.statusDetalhe,
      valorLiquidoCentavos: intencao.valorLiquido?.centavos ?? null,
      meio: intencao.meio,
      estornoSolicitadoEm: intencao.estornoSolicitadoEm,
      estornoGatewayId: intencao.estornoGatewayId,
      estornoErro: intencao.estornoErro,
    };
    await this.db.intencaoDePagamento.upsert({
      where: { id: intencao.id },
      create: { id: intencao.id, ...dados },
      update: dados,
    });
  }
}
