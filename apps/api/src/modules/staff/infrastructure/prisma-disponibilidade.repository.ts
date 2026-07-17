import { OrigemDisponibilidade } from '@bigods/contracts';
import { Disponibilidade as DisponibilidadePrisma } from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { DisponibilidadeBarbeiro } from '../domain/disponibilidade.aggregate';
import { DisponibilidadeRepository } from '../domain/disponibilidade.repository';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { BarbeiroId, DisponibilidadeId } from '../../../shared/domain/ids';

function paraDominio(row: DisponibilidadePrisma): DisponibilidadeBarbeiro {
  return DisponibilidadeBarbeiro.reconstituir({
    id: row.id,
    barbeiroId: row.barbeiroId,
    data: row.data,
    janela: IntervaloDeTempo.de(row.inicio, row.fim),
    origem: OrigemDisponibilidade[row.origem],
  });
}

export class PrismaDisponibilidadeRepository implements DisponibilidadeRepository {
  constructor(private readonly db: Db) {}

  async porId(id: DisponibilidadeId): Promise<DisponibilidadeBarbeiro | null> {
    const row = await this.db.disponibilidade.findUnique({ where: { id } });
    return row ? paraDominio(row) : null;
  }

  async porBarbeiroEData(barbeiroId: BarbeiroId, data: string): Promise<DisponibilidadeBarbeiro[]> {
    const rows = await this.db.disponibilidade.findMany({ where: { barbeiroId, data } });
    return rows.map(paraDominio);
  }

  async porBarbeiro(barbeiroId: BarbeiroId): Promise<DisponibilidadeBarbeiro[]> {
    const rows = await this.db.disponibilidade.findMany({
      where: { barbeiroId },
      orderBy: [{ data: 'asc' }, { inicio: 'asc' }],
    });
    return rows.map(paraDominio);
  }

  async salvar(d: DisponibilidadeBarbeiro): Promise<void> {
    const dados = {
      barbeiroId: d.barbeiroId,
      data: d.data,
      inicio: d.janela.inicio,
      fim: d.janela.fim,
      origem: d.origem,
    };
    await this.db.disponibilidade.upsert({
      where: { id: d.id },
      create: { id: d.id, ...dados },
      update: dados,
    });
  }

  async remover(id: DisponibilidadeId): Promise<void> {
    await this.db.disponibilidade.delete({ where: { id } });
  }
}
