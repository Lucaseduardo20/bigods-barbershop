import { FormaPagamento } from '@bigods/contracts';
import { ItemVendaDeProduto as ItemPrisma, VendaDeProduto as VendaPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { VendaDeProduto } from '../domain/venda-de-produto.aggregate';
import { VendaDeProdutoRepository } from '../domain/venda-de-produto.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId, VendaDeProdutoId } from '../../../shared/domain/ids';

type Row = VendaPrisma & { itens: ItemPrisma[] };
const include = { itens: true } as const;

function paraDominio(row: Row): VendaDeProduto {
  return VendaDeProduto.reconstituir({
    id: row.id,
    companyId: row.companyId,
    barbeiroId: row.barbeiroId,
    clienteId: row.clienteId,
    itens: row.itens.map((i) => ({
      produtoId: i.produtoId,
      quantidade: i.quantidade,
      valorUnitario: Dinheiro.deCentavos(i.valorUnitarioCentavos),
    })),
    formaPagamento: FormaPagamento[row.formaPagamento],
    vendidoEm: row.vendidoEm,
  });
}

export class PrismaVendaDeProdutoRepository implements VendaDeProdutoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: VendaDeProdutoId): Promise<VendaDeProduto | null> {
    const row = await this.db.vendaDeProduto.findUnique({ where: { id }, include });
    return row ? paraDominio(row) : null;
  }

  async listar(companyId: CompanyId): Promise<VendaDeProduto[]> {
    const rows = await this.db.vendaDeProduto.findMany({
      where: { companyId },
      include,
      orderBy: { vendidoEm: 'desc' },
    });
    return rows.map(paraDominio);
  }

  /** Venda avulsa não é mutada depois de registrada — só create. */
  async salvar(venda: VendaDeProduto): Promise<void> {
    await this.db.vendaDeProduto.create({
      data: {
        id: venda.id,
        companyId: venda.companyId,
        barbeiroId: venda.barbeiroId,
        clienteId: venda.clienteId,
        formaPagamento: venda.formaPagamento,
        vendidoEm: venda.vendidoEm,
        itens: {
          create: venda.itens.map((i) => ({
            produtoId: i.produtoId,
            quantidade: i.quantidade,
            valorUnitarioCentavos: i.valorUnitario.centavos,
          })),
        },
      },
    });
  }
}
