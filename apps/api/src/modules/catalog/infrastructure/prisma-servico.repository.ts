import { Servico as ServicoPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Servico } from '../domain/servico.aggregate';
import { ServicoRepository } from '../domain/servico.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { CompanyId, ServicoId } from '../../../shared/domain/ids';

function paraDominio(row: ServicoPrisma): Servico {
  return Servico.reconstituir({
    id: row.id,
    companyId: row.companyId,
    nome: row.nome,
    precoAvulso: Dinheiro.deCentavos(row.precoAvulsoCentavos),
    duracao: Duracao.deMinutos(row.duracaoMinutos),
    ativo: row.ativo,
  });
}

export class PrismaServicoRepository implements ServicoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: ServicoId): Promise<Servico | null> {
    const row = await this.db.servico.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porIds(ids: ServicoId[]): Promise<Servico[]> {
    const rows = await this.db.servico.findMany({ where: { id: { in: ids } } });
    return rows.map(paraDominio);
  }

  async listar(companyId: CompanyId): Promise<Servico[]> {
    const rows = await this.db.servico.findMany({ where: { companyId }, orderBy: { nome: 'asc' } });
    return rows.map(paraDominio);
  }

  async salvar(servico: Servico): Promise<void> {
    const dados = {
      companyId: servico.companyId,
      nome: servico.nome,
      precoAvulsoCentavos: servico.precoAvulso.centavos,
      duracaoMinutos: servico.duracao.minutos,
      ativo: servico.ativo,
    };
    await this.db.servico.upsert({
      where: { id: servico.id },
      create: { id: servico.id, ...dados },
      update: dados,
    });
  }
}
