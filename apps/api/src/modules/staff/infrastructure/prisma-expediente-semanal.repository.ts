import { ExpedienteJanela as ExpedienteJanelaPrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { DiaSemana, ExpedienteSemanal, JanelaExpediente } from '../domain/expediente-semanal.aggregate';
import { ExpedienteSemanalRepository } from '../domain/expediente-semanal.repository';
import { BarbeiroId, CompanyId } from '../../../shared/domain/ids';

function agruparPorBarbeiro(rows: ExpedienteJanelaPrisma[]): Map<BarbeiroId, ExpedienteJanelaPrisma[]> {
  const mapa = new Map<BarbeiroId, ExpedienteJanelaPrisma[]>();
  for (const row of rows) {
    const lista = mapa.get(row.barbeiroId) ?? [];
    lista.push(row);
    mapa.set(row.barbeiroId, lista);
  }
  return mapa;
}

function paraDominio(barbeiroId: BarbeiroId, companyId: CompanyId, rows: ExpedienteJanelaPrisma[]): ExpedienteSemanal {
  const dias = new Map<DiaSemana, JanelaExpediente[]>();
  for (const row of rows) {
    const dia = row.diaSemana as DiaSemana;
    const lista = dias.get(dia) ?? [];
    lista.push({ inicio: row.horaInicio, fim: row.horaFim });
    dias.set(dia, lista);
  }
  return ExpedienteSemanal.reconstituir({ barbeiroId, companyId, dias });
}

export class PrismaExpedienteSemanalRepository implements ExpedienteSemanalRepository {
  constructor(private readonly db: Db) {}

  async porBarbeiro(barbeiroId: BarbeiroId): Promise<ExpedienteSemanal | null> {
    const barbeiro = await this.db.barbeiro.findUnique({ where: { id: barbeiroId } });
    if (!barbeiro) return null;
    const rows = await this.db.expedienteJanela.findMany({ where: { barbeiroId } });
    if (rows.length === 0) return null; // sem expediente definido — a materialização não toca nesse barbeiro
    return paraDominio(barbeiroId, barbeiro.companyId, rows);
  }

  async listarPorEmpresa(companyId: CompanyId): Promise<ExpedienteSemanal[]> {
    const rows = await this.db.expedienteJanela.findMany({ where: { barbeiro: { companyId } } });
    const porBarbeiro = agruparPorBarbeiro(rows);
    return [...porBarbeiro.entries()].map(([barbeiroId, janelas]) => paraDominio(barbeiroId, companyId, janelas));
  }

  /** Reaplica do zero: delete-all + recreate (as janelas não têm identidade própria no domínio). */
  async salvar(expediente: ExpedienteSemanal): Promise<void> {
    await this.db.expedienteJanela.deleteMany({ where: { barbeiroId: expediente.barbeiroId } });
    const linhas = [...expediente.dias.entries()].flatMap(([diaSemana, janelas]) =>
      janelas.map((j) => ({
        barbeiroId: expediente.barbeiroId,
        diaSemana,
        horaInicio: j.inicio,
        horaFim: j.fim,
      })),
    );
    if (linhas.length > 0) {
      await this.db.expedienteJanela.createMany({ data: linhas });
    }
  }
}
