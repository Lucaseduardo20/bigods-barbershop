import { StatusItemPacote, StatusPagamento } from '@bigods/contracts';
import {
  ItemDoPacote as ItemDoPacotePrisma,
  VendaDePacote as VendaDePacotePrisma,
} from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { VendaDePacote } from '../domain/venda-de-pacote.aggregate';
import { VendaDePacoteRepository } from '../domain/venda-de-pacote.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { ClienteId, CompanyId, ItemDoPacoteId, VendaDePacoteId } from '../../../shared/domain/ids';

type Row = VendaDePacotePrisma & { itens: ItemDoPacotePrisma[] };
const include = { itens: { orderBy: { id: 'asc' as const } } };

function paraDominio(row: Row): VendaDePacote {
  return VendaDePacote.reconstituir({
    id: row.id,
    companyId: row.companyId,
    clienteId: row.clienteId,
    barbeiroId: row.barbeiroId,
    valorPago: Dinheiro.deCentavos(row.valorPagoCentavos),
    saldoResidual: Dinheiro.deCentavos(row.saldoResidualCentavos),
    compradoEm: row.compradoEm,
    statusPagamento: StatusPagamento[row.statusPagamento],
    origemLinkBarbeiroId: row.origemLinkBarbeiroId,
    itens: row.itens.map((i) => ({
      id: i.id,
      servicoId: i.servicoId,
      valorRateado: Dinheiro.deCentavos(i.valorRateadoCentavos),
      status: StatusItemPacote[i.status],
      faltasComputadas: i.faltasComputadas as 0 | 1,
      prazoReagendamentoAte: i.prazoReagendamentoAte,
      atendimentoId: i.atendimentoId,
    })),
  });
}

export class PrismaVendaDePacoteRepository implements VendaDePacoteRepository {
  constructor(private readonly db: Db) {}

  async porId(id: VendaDePacoteId): Promise<VendaDePacote | null> {
    const row = await this.db.vendaDePacote.findUnique({ where: { id }, include });
    return row ? paraDominio(row) : null;
  }

  async porItemId(itemId: ItemDoPacoteId): Promise<VendaDePacote | null> {
    const item = await this.db.itemDoPacote.findUnique({ where: { id: itemId } });
    return item ? this.porId(item.vendaId) : null;
  }

  async listarPorCliente(clienteId: ClienteId): Promise<VendaDePacote[]> {
    const rows = await this.db.vendaDePacote.findMany({
      where: { clienteId },
      include,
      orderBy: { compradoEm: 'desc' },
    });
    return rows.map(paraDominio);
  }

  async listar(companyId: CompanyId): Promise<VendaDePacote[]> {
    const rows = await this.db.vendaDePacote.findMany({
      where: { companyId },
      include,
      orderBy: { compradoEm: 'desc' },
    });
    return rows.map(paraDominio);
  }

  async comItensEmSegundaChanceVencidos(hoje: Date): Promise<VendaDePacote[]> {
    const rows = await this.db.vendaDePacote.findMany({
      where: {
        itens: { some: { status: 'SEGUNDA_CHANCE', prazoReagendamentoAte: { lt: hoje } } },
      },
      include,
    });
    return rows.map(paraDominio);
  }

  async salvar(venda: VendaDePacote): Promise<void> {
    const dadosVenda = {
      companyId: venda.companyId,
      clienteId: venda.clienteId,
      barbeiroId: venda.barbeiroId,
      valorPagoCentavos: venda.valorPago.centavos,
      saldoResidualCentavos: venda.saldoResidual.centavos,
      compradoEm: venda.compradoEm,
      statusPagamento: venda.statusPagamento,
      origemLinkBarbeiroId: venda.origemLinkBarbeiroId,
    };
    await this.db.vendaDePacote.upsert({
      where: { id: venda.id },
      create: { id: venda.id, ...dadosVenda },
      update: dadosVenda,
    });
    for (const item of venda.itens) {
      const dadosItem = {
        vendaId: venda.id,
        servicoId: item.servicoId,
        valorRateadoCentavos: item.valorRateado.centavos,
        status: item.status,
        faltasComputadas: item.faltasComputadas,
        prazoReagendamentoAte: item.prazoReagendamentoAte,
        atendimentoId: item.atendimentoId,
      };
      await this.db.itemDoPacote.upsert({
        where: { id: item.id },
        create: { id: item.id, ...dadosItem },
        update: dadosItem,
      });
    }
  }
}
