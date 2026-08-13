import { StatusVale } from '@bigods/contracts';
import { Vale as ValePrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Vale } from '../domain/vale.aggregate';
import { ValeRepository } from '../domain/vale.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { BarbeiroId, CompanyId, ValeId } from '../../../shared/domain/ids';

function paraDominio(row: ValePrisma): Vale {
  return Vale.reconstituir({
    id: row.id,
    companyId: row.companyId,
    barbeiroId: row.barbeiroId,
    valor: Dinheiro.deCentavos(row.valorCentavos),
    motivo: row.motivo,
    status: StatusVale[row.status],
    solicitadoEm: row.solicitadoEm,
    decididoPorId: row.decididoPorId,
    decididoEm: row.decididoEm,
    motivoNegacao: row.motivoNegacao,
    pagoPorId: row.pagoPorId,
    pagoEm: row.pagoEm,
  });
}

export class PrismaValeRepository implements ValeRepository {
  constructor(private readonly db: Db) {}

  async porId(id: ValeId): Promise<Vale | null> {
    const row = await this.db.vale.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porBarbeiro(barbeiroId: BarbeiroId): Promise<Vale[]> {
    const rows = await this.db.vale.findMany({ where: { barbeiroId }, orderBy: { solicitadoEm: 'desc' } });
    return rows.map(paraDominio);
  }

  async listar(companyId: CompanyId): Promise<Vale[]> {
    const rows = await this.db.vale.findMany({ where: { companyId }, orderBy: { solicitadoEm: 'desc' } });
    return rows.map(paraDominio);
  }

  async salvar(vale: Vale): Promise<void> {
    const dados = {
      companyId: vale.companyId,
      barbeiroId: vale.barbeiroId,
      valorCentavos: vale.valor.centavos,
      motivo: vale.motivo,
      status: vale.status,
      solicitadoEm: vale.solicitadoEm,
      decididoPorId: vale.decididoPorId,
      decididoEm: vale.decididoEm,
      motivoNegacao: vale.motivoNegacao,
      pagoPorId: vale.pagoPorId,
      pagoEm: vale.pagoEm,
    };
    await this.db.vale.upsert({
      where: { id: vale.id },
      create: { id: vale.id, ...dados },
      update: dados,
    });
  }
}
