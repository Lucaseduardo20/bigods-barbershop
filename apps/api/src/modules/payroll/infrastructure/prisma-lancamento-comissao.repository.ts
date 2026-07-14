import { LancamentoComissao as LancamentoPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { LancamentoComissao } from '../domain/lancamento-comissao.aggregate';
import { LancamentoComissaoRepository } from '../domain/lancamento-comissao.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Percentual } from '../../../shared/domain/percentual';
import { AtendimentoId, BarbeiroId, CompanyId } from '../../../shared/domain/ids';

function paraDominio(row: LancamentoPrisma): LancamentoComissao {
  return LancamentoComissao.reconstituir({
    id: row.id,
    companyId: row.companyId,
    barbeiroId: row.barbeiroId,
    atendimentoId: row.atendimentoId,
    servicoId: row.servicoId,
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
        atendimentoId: lancamento.atendimentoId,
        servicoId: lancamento.servicoId,
        valorBaseCentavos: lancamento.valorBase.centavos,
        percentualAplicadoBp: lancamento.percentualAplicado.pontosBase,
        valorComissaoCentavos: lancamento.valorComissao.centavos,
        ocorridoEm: lancamento.ocorridoEm,
      },
    });
  }
}
