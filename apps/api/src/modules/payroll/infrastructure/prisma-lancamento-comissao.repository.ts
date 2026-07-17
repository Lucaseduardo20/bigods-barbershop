import { OrigemComissao } from '@bigods/contracts';
import { LancamentoComissao as LancamentoPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import { LancamentoComissaoRepository } from '../domain/lancamento-comissao.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';
import { AtendimentoId, BarbeiroId, CompanyId, VendaDeProdutoId } from '../../../shared/domain/ids';

function paraDominio(row: LancamentoPrisma): LancamentoComissao {
  return LancamentoComissao.reconstituir({
    id: row.id,
    companyId: row.companyId,
    barbeiroId: row.barbeiroId,
    origem: OrigemComissao[row.origem],
    atendimentoId: row.atendimentoId,
    vendaDeProdutoId: row.vendaDeProdutoId,
    servicoId: row.servicoId,
    produtoId: row.produtoId,
    valorBase: Dinheiro.deCentavos(row.valorBaseCentavos),
    percentualAplicado: Percentual.dePontosBase(row.percentualAplicadoBp),
    valorComissao: Dinheiro.deCentavos(row.valorComissaoCentavos),
    ocorridoEm: row.ocorridoEm,
  });
}

export class PrismaLancamentoComissaoRepository implements LancamentoComissaoRepository {
  constructor(private readonly db: Db) {}

  async porBarbeiro(barbeiroId: BarbeiroId): Promise<LancamentoComissao[]> {
    const rows = await this.db.lancamentoComissao.findMany({
      where: { barbeiroId },
      orderBy: { ocorridoEm: 'desc' },
    });
    return rows.map(paraDominio);
  }

  async porAtendimento(atendimentoId: AtendimentoId): Promise<LancamentoComissao[]> {
    const rows = await this.db.lancamentoComissao.findMany({ where: { atendimentoId } });
    return rows.map(paraDominio);
  }

  async porVendaDeProduto(vendaId: VendaDeProdutoId): Promise<LancamentoComissao[]> {
    const rows = await this.db.lancamentoComissao.findMany({ where: { vendaDeProdutoId: vendaId } });
    return rows.map(paraDominio);
  }

  async listar(companyId: CompanyId): Promise<LancamentoComissao[]> {
    const rows = await this.db.lancamentoComissao.findMany({
      where: { companyId },
      orderBy: { ocorridoEm: 'desc' },
    });
    return rows.map(paraDominio);
  }

  /** Ledger imutável: só INSERT, nunca update. */
  async salvar(lancamento: LancamentoComissao): Promise<void> {
    await this.db.lancamentoComissao.create({
      data: {
        id: lancamento.id,
        companyId: lancamento.companyId,
        barbeiroId: lancamento.barbeiroId,
        origem: lancamento.origem,
        atendimentoId: lancamento.atendimentoId,
        vendaDeProdutoId: lancamento.vendaDeProdutoId,
        servicoId: lancamento.servicoId,
        produtoId: lancamento.produtoId,
        valorBaseCentavos: lancamento.valorBase.centavos,
        percentualAplicadoBp: lancamento.percentualAplicado.pontosBase,
        valorComissaoCentavos: lancamento.valorComissao.centavos,
        ocorridoEm: lancamento.ocorridoEm,
      },
    });
  }
}
