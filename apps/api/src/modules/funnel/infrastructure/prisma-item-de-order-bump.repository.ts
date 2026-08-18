import { ItemDeOrderBump as ItemPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId } from '../../../shared/domain/ids';
import { ItemDeOrderBump, TipoItemDeOrderBump } from '../domain/item-de-order-bump.aggregate';
import { ItemDeOrderBumpRepository } from '../domain/item-de-order-bump.repository';

function paraDominio(row: ItemPrisma): ItemDeOrderBump {
  return ItemDeOrderBump.reconstituir({
    id: row.id,
    companyId: row.companyId,
    tipo: TipoItemDeOrderBump[row.tipo],
    referenciaId: row.referenciaId,
    ativo: row.ativo,
    precoPromocional:
      row.precoPromocionalCentavos === null ? null : Dinheiro.deCentavos(row.precoPromocionalCentavos),
    mensagem: row.mensagem,
    ordem: row.ordem,
  });
}

export class PrismaItemDeOrderBumpRepository implements ItemDeOrderBumpRepository {
  constructor(private readonly db: Db) {}

  async listarPorEmpresa(companyId: CompanyId): Promise<ItemDeOrderBump[]> {
    const rows = await this.db.itemDeOrderBump.findMany({
      where: { companyId },
      orderBy: [{ ordem: 'asc' }],
    });
    return rows.map(paraDominio);
  }

  async porReferencia(
    companyId: CompanyId,
    tipo: TipoItemDeOrderBump,
    referenciaId: string,
  ): Promise<ItemDeOrderBump | null> {
    const row = await this.db.itemDeOrderBump.findUnique({
      where: { companyId_tipo_referenciaId: { companyId, tipo, referenciaId } },
    });
    return row ? paraDominio(row) : null;
  }

  async salvar(item: ItemDeOrderBump): Promise<void> {
    const dados = {
      companyId: item.companyId,
      tipo: item.tipo,
      referenciaId: item.referenciaId,
      ativo: item.ativo,
      precoPromocionalCentavos: item.precoPromocional?.centavos ?? null,
      mensagem: item.mensagem,
      ordem: item.ordem,
    };
    await this.db.itemDeOrderBump.upsert({
      where: { id: item.id },
      create: { id: item.id, ...dados },
      update: dados,
    });
  }
}
