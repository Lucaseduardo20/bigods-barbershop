import { StatusPagamento } from '@bigods/contracts';
import { IntencaoDePagamento as IntencaoPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import {
  IntencaoDePagamento,
  ReferenciaDePagamento,
} from '../domain/intencao-de-pagamento.aggregate';
import { IntencaoDePagamentoRepository } from '../domain/intencao-de-pagamento.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { IntencaoDePagamentoId } from '../../../shared/domain/ids';

function paraDominio(row: IntencaoPrisma): IntencaoDePagamento {
  const referencia: ReferenciaDePagamento =
    row.referenciaTipo === 'ATENDIMENTO'
      ? { tipo: 'ATENDIMENTO', atendimentoId: row.atendimentoId! }
      : { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: row.vendaDePacoteId! };
  return IntencaoDePagamento.reconstituir({
    id: row.id,
    companyId: row.companyId,
    referencia,
    valor: Dinheiro.deCentavos(row.valorCentavos),
    status: StatusPagamento[row.status],
    externalId: row.externalId,
  });
}

export class PrismaIntencaoDePagamentoRepository implements IntencaoDePagamentoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: IntencaoDePagamentoId): Promise<IntencaoDePagamento | null> {
    const row = await this.db.intencaoDePagamento.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porExternalId(externalId: string): Promise<IntencaoDePagamento | null> {
    const row = await this.db.intencaoDePagamento.findUnique({ where: { externalId } });
    return row ? paraDominio(row) : null;
  }

  async salvar(intencao: IntencaoDePagamento): Promise<void> {
    const { referencia } = intencao;
    const dados = {
      companyId: intencao.companyId,
      referenciaTipo: referencia.tipo,
      atendimentoId: referencia.tipo === 'ATENDIMENTO' ? referencia.atendimentoId : null,
      vendaDePacoteId: referencia.tipo === 'VENDA_DE_PACOTE' ? referencia.vendaDePacoteId : null,
      valorCentavos: intencao.valor.centavos,
      status: intencao.status,
      externalId: intencao.externalId,
    };
    await this.db.intencaoDePagamento.upsert({
      where: { id: intencao.id },
      create: { id: intencao.id, ...dados },
      update: dados,
    });
  }
}
