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

  /**
   * `deleteMany` e não `delete`: apagar o que já não existe precisa ser um
   * no-op, não uma exceção.
   *
   * O caso real (2026-08-24, primeiro erro capturado pelo Sentry): a
   * materialização do expediente LÊ as disponibilidades do dia e depois apaga
   * uma a uma por id. Ela roda em dois lugares — o cron das 4h e o
   * `DefinirExpedienteUseCase`, quando o admin salva o expediente. Duas
   * execuções concorrentes do mesmo barbeiro/dia leem a mesma lista, e a
   * segunda tenta apagar o que a primeira já apagou: `P2025`, exceção não
   * tratada, cron interrompido no meio.
   *
   * `delete` por id não enfraquece o `DELETE /disponibilidades/:id`, que
   * confere a existência e devolve 404 ANTES de chamar aqui — 404 é resposta
   * de API, não erro de repositório.
   */
  async remover(id: DisponibilidadeId): Promise<void> {
    await this.db.disponibilidade.deleteMany({ where: { id } });
  }
}
