import {
  FormaPagamento,
  OrigemAtendimento,
  StatusAtendimento,
} from '@bigods/contracts';
import {
  Atendimento as AtendimentoPrisma,
  ItemAtendido as ItemAtendidoPrisma,
} from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Atendimento } from '../domain/atendimento.aggregate';
import { AtendimentoRepository } from '../domain/atendimento.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { AtendimentoId, BarbeiroId, ClienteId, CompanyId } from '../../../shared/domain/ids';

type Row = AtendimentoPrisma & { itens: ItemAtendidoPrisma[] };
const include = { itens: true } as const;

function paraDominio(row: Row): Atendimento {
  return Atendimento.reconstituir({
    id: row.id,
    companyId: row.companyId,
    clienteId: row.clienteId,
    barbeiroId: row.barbeiroId,
    itens: row.itens.map((i) => ({
      servicoId: i.servicoId,
      valorCobrado: Dinheiro.deCentavos(i.valorCobradoCentavos),
      duracao: Duracao.deMinutos(i.duracaoMinutos),
      itemDoPacoteId: i.itemDoPacoteId,
    })),
    intervalo: IntervaloDeTempo.de(row.inicio, row.fim),
    status: StatusAtendimento[row.status],
    origem: OrigemAtendimento[row.origem],
    formaPagamento: row.formaPagamento ? FormaPagamento[row.formaPagamento] : null,
    motivoCancelamento: row.motivoCancelamento,
  });
}

export class PrismaAtendimentoRepository implements AtendimentoRepository {
  constructor(private readonly db: Db) {}

  async porId(id: AtendimentoId): Promise<Atendimento | null> {
    const row = await this.db.atendimento.findUnique({ where: { id }, include });
    return row ? paraDominio(row) : null;
  }

  async agendadosDoBarbeiroNoPeriodo(
    barbeiroId: BarbeiroId,
    inicio: Date,
    fim: Date,
  ): Promise<Atendimento[]> {
    const rows = await this.db.atendimento.findMany({
      where: {
        barbeiroId,
        status: 'AGENDADO',
        inicio: { lt: fim },
        fim: { gt: inicio },
      },
      include,
    });
    return rows.map(paraDominio);
  }

  async listarPorPeriodo(companyId: CompanyId, inicio: Date, fim: Date): Promise<Atendimento[]> {
    const rows = await this.db.atendimento.findMany({
      where: { companyId, inicio: { lt: fim }, fim: { gt: inicio } },
      include,
      orderBy: { inicio: 'asc' },
    });
    return rows.map(paraDominio);
  }

  async listarPorCliente(clienteId: ClienteId): Promise<Atendimento[]> {
    const rows = await this.db.atendimento.findMany({
      where: { clienteId },
      include,
      orderBy: { inicio: 'desc' },
    });
    return rows.map(paraDominio);
  }

  async salvar(atendimento: Atendimento): Promise<void> {
    const dados = {
      companyId: atendimento.companyId,
      clienteId: atendimento.clienteId,
      barbeiroId: atendimento.barbeiroId,
      inicio: atendimento.intervalo.inicio,
      fim: atendimento.intervalo.fim,
      status: atendimento.status,
      origem: atendimento.origem,
      formaPagamento: atendimento.formaPagamento,
      motivoCancelamento: atendimento.motivoCancelamento,
    };
    const existente = await this.db.atendimento.findUnique({ where: { id: atendimento.id } });
    if (existente) {
      await this.db.atendimento.update({ where: { id: atendimento.id }, data: dados });
    } else {
      await this.db.atendimento.create({
        data: {
          id: atendimento.id,
          ...dados,
          itens: {
            create: atendimento.itens.map((i) => ({
              servicoId: i.servicoId,
              valorCobradoCentavos: i.valorCobrado.centavos,
              duracaoMinutos: i.duracao.minutos,
              itemDoPacoteId: i.itemDoPacoteId,
            })),
          },
        },
      });
    }
  }
}
