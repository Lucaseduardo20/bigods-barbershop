import { Papel } from '@bigods/contracts';
import {
  Barbeiro as BarbeiroPrisma,
  BarbeiroServico,
  ExcecaoComissao,
  ExcecaoPreco,
} from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Barbeiro } from '../domain/barbeiro.aggregate';
import { BarbeiroRepository } from '../domain/barbeiro.repository';
import { Percentual } from '../../../shared/domain/percentual';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { BarbeiroId, CompanyId } from '../../../shared/domain/ids';

type Row = BarbeiroPrisma & {
  excecoesComissao: ExcecaoComissao[];
  servicosAtendidos: BarbeiroServico[];
  excecoesPreco: ExcecaoPreco[];
};

const include = { excecoesComissao: true, servicosAtendidos: true, excecoesPreco: true } as const;

function paraDominio(row: Row): Barbeiro {
  return Barbeiro.reconstituir({
    id: row.id,
    companyId: row.companyId,
    nome: row.nome,
    slug: row.slug,
    papeis: new Set(row.papeis.map((p) => Papel[p])),
    comissaoPadrao: Percentual.dePontosBase(row.comissaoPadraoBp),
    comissaoProdutos: Percentual.dePontosBase(row.comissaoProdutosBp),
    excecoesComissao: new Map(
      row.excecoesComissao.map((e) => [e.servicoId, Percentual.dePontosBase(e.percentualBp)]),
    ),
    servicosAtendidos: new Set(row.servicosAtendidos.map((s) => s.servicoId)),
    precosServicos: new Map(row.excecoesPreco.map((e) => [e.servicoId, Dinheiro.deCentavos(e.precoCentavos)])),
    fotoUrl: row.fotoUrl,
    ativo: row.ativo,
  });
}

export class PrismaBarbeiroRepository implements BarbeiroRepository {
  constructor(private readonly db: Db) {}

  async porId(id: BarbeiroId): Promise<Barbeiro | null> {
    const row = await this.db.barbeiro.findUnique({ where: { id }, include });
    return row ? paraDominio(row) : null;
  }

  async porSlug(companyId: CompanyId, slug: string): Promise<Barbeiro | null> {
    const row = await this.db.barbeiro.findUnique({ where: { companyId_slug: { companyId, slug } }, include });
    return row ? paraDominio(row) : null;
  }

  async listar(companyId: CompanyId): Promise<Barbeiro[]> {
    const rows = await this.db.barbeiro.findMany({ where: { companyId, papeis: {has: Papel.BARBEIRO} }, include, orderBy: { nome: 'asc' } });
    return rows.map(paraDominio);
  }

  async listarTodos(companyId: CompanyId): Promise<Barbeiro[]> {
    const rows = await this.db.barbeiro.findMany({ where: { companyId }, include, orderBy: { nome: 'asc' } });
    return rows.map(paraDominio);
  }

  async salvar(barbeiro: Barbeiro): Promise<void> {
    const dados = {
      companyId: barbeiro.companyId,
      nome: barbeiro.nome,
      slug: barbeiro.slug,
      papeis: [...barbeiro.papeis],
      comissaoPadraoBp: barbeiro.comissaoPadrao.pontosBase,
      comissaoProdutosBp: barbeiro.comissaoProdutos.pontosBase,
      fotoUrl: barbeiro.fotoUrl,
      ativo: barbeiro.ativo,
    };
    await this.db.barbeiro.upsert({
      where: { id: barbeiro.id },
      create: { id: barbeiro.id, ...dados },
      update: dados,
    });
    await this.db.excecaoComissao.deleteMany({ where: { barbeiroId: barbeiro.id } });
    if (barbeiro.excecoesComissao.size > 0) {
      await this.db.excecaoComissao.createMany({
        data: [...barbeiro.excecoesComissao].map(([servicoId, p]) => ({
          barbeiroId: barbeiro.id,
          servicoId,
          percentualBp: p.pontosBase,
        })),
      });
    }
    await this.db.barbeiroServico.deleteMany({ where: { barbeiroId: barbeiro.id } });
    if (barbeiro.servicosAtendidos.size > 0) {
      await this.db.barbeiroServico.createMany({
        data: [...barbeiro.servicosAtendidos].map((servicoId) => ({
          barbeiroId: barbeiro.id,
          servicoId,
        })),
      });
    }
    await this.db.excecaoPreco.deleteMany({ where: { barbeiroId: barbeiro.id } });
    if (barbeiro.precosServicos.size > 0) {
      await this.db.excecaoPreco.createMany({
        data: [...barbeiro.precosServicos].map(([servicoId, preco]) => ({
          barbeiroId: barbeiro.id,
          servicoId,
          precoCentavos: preco.centavos,
        })),
      });
    }
  }
}
