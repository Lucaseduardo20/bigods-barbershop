import { OrigemComissao, TipoLancamento } from '@bigods/contracts';
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
    tipo: TipoLancamento[row.tipo],
    origem: row.origem ? OrigemComissao[row.origem] : null,
    atendimentoId: row.atendimentoId,
    vendaDeProdutoId: row.vendaDeProdutoId,
    servicoId: row.servicoId,
    produtoId: row.produtoId,
    valeId: row.valeId,
    registradoPorId: row.registradoPorId,
    valorBase: row.valorBaseCentavos !== null ? Dinheiro.deCentavos(row.valorBaseCentavos) : null,
    percentualAplicado: row.percentualAplicadoBp !== null ? Percentual.dePontosBase(row.percentualAplicadoBp) : null,
    valorComissao: Dinheiro.deCentavos(row.valorComissaoCentavos),
    ocorridoEm: row.ocorridoEm,
    estornoDeId: row.estornoDeId,
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
        tipo: lancamento.tipo,
        origem: lancamento.origem,
        atendimentoId: lancamento.atendimentoId,
        vendaDeProdutoId: lancamento.vendaDeProdutoId,
        servicoId: lancamento.servicoId,
        produtoId: lancamento.produtoId,
        valeId: lancamento.valeId,
        registradoPorId: lancamento.registradoPorId,
        estornoDeId: lancamento.estornoDeId,
        valorBaseCentavos: lancamento.valorBase?.centavos ?? null,
        percentualAplicadoBp: lancamento.percentualAplicado?.pontosBase ?? null,
        valorComissaoCentavos: lancamento.valorComissao.centavos,
        ocorridoEm: lancamento.ocorridoEm,
      },
    });
  }
}
