import { Produto as ProdutoPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Produto } from '../domain/produto.aggregate';
import { ProdutoRepository } from '../domain/produto.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId, ProdutoId } from '../../../shared/domain/ids';

function paraDominio(row: ProdutoPrisma): Produto {
  return Produto.reconstituir({
    id: row.id,
    companyId: row.companyId,
    nome: row.nome,
    preco: Dinheiro.deCentavos(row.precoCentavos),
    fotoUrl: row.fotoUrl,
    ativo: row.ativo,
  });
}

export class PrismaProdutoRepository implements ProdutoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: ProdutoId): Promise<Produto | null> {
    const row = await this.db.produto.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porIds(ids: ProdutoId[]): Promise<Produto[]> {
    const rows = await this.db.produto.findMany({ where: { id: { in: ids } } });
    return rows.map(paraDominio);
  }

  async listar(companyId: CompanyId): Promise<Produto[]> {
    const rows = await this.db.produto.findMany({ where: { companyId }, orderBy: { nome: 'asc' } });
    return rows.map(paraDominio);
  }

  async salvar(produto: Produto): Promise<void> {
    const dados = {
      companyId: produto.companyId,
      nome: produto.nome,
      precoCentavos: produto.preco.centavos,
      fotoUrl: produto.fotoUrl,
      ativo: produto.ativo,
    };
    await this.db.produto.upsert({
      where: { id: produto.id },
      create: { id: produto.id, ...dados },
      update: dados,
    });
  }
}
