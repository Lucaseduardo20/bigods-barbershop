import {
  FormaPagamento,
  OrigemAtendimento,
  StatusAtendimento,
} from '@bigods/contracts';
import {
  Atendimento as AtendimentoPrisma,
  ItemAtendido as ItemAtendidoPrisma,
  ItemProdutoAtendido as ItemProdutoAtendidoPrisma,
} from '@prisma/client';
import { Db } from '../../../shared/infrastructure/db';
import { Atendimento } from '../domain/atendimento.aggregate';
import { AtendimentoRepository } from '../domain/atendimento.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Duracao } from '../../../shared/domain/duracao';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { AtendimentoId, BarbeiroId, ClienteId, CompanyId } from '../../../shared/domain/ids';

type Row = AtendimentoPrisma & { itens: ItemAtendidoPrisma[]; produtos: ItemProdutoAtendidoPrisma[] };
const include = { itens: true, produtos: true } as const;

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
    produtos: row.produtos.map((p) => ({
      produtoId: p.produtoId,
      quantidade: p.quantidade,
      valorUnitario: Dinheiro.deCentavos(p.valorUnitarioCentavos),
    })),
    intervalo: IntervaloDeTempo.de(row.inicio, row.fim),
    status: StatusAtendimento[row.status],
    origem: OrigemAtendimento[row.origem],
    formaPagamento: row.formaPagamento ? FormaPagamento[row.formaPagamento] : null,
    motivoCancelamento: row.motivoCancelamento,
    origemLinkBarbeiroId: row.origemLinkBarbeiroId,
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
      origemLinkBarbeiroId: atendimento.origemLinkBarbeiroId,
    };
    const existente = await this.db.atendimento.findUnique({ where: { id: atendimento.id } });
    if (existente) {
      await this.db.atendimento.update({ where: { id: atendimento.id }, data: dados });
      // itens/produtos não têm identidade estável no domínio (podem ser
      // adicionados pós-criação — item 3/4a da sessão 2026-07-16): replace
      // completo é simples e correto (nenhuma outra tabela referencia a PK
      // gerada dessas linhas fora desta mesma transação).
      await this.db.itemAtendido.deleteMany({ where: { atendimentoId: atendimento.id } });
      if (atendimento.itens.length > 0) {
        await this.db.itemAtendido.createMany({
          data: atendimento.itens.map((i) => ({
            atendimentoId: atendimento.id,
            servicoId: i.servicoId,
            valorCobradoCentavos: i.valorCobrado.centavos,
            duracaoMinutos: i.duracao.minutos,
            itemDoPacoteId: i.itemDoPacoteId,
          })),
        });
      }
      await this.db.itemProdutoAtendido.deleteMany({ where: { atendimentoId: atendimento.id } });
      if (atendimento.produtos.length > 0) {
        await this.db.itemProdutoAtendido.createMany({
          data: atendimento.produtos.map((p) => ({
            atendimentoId: atendimento.id,
            produtoId: p.produtoId,
            quantidade: p.quantidade,
            valorUnitarioCentavos: p.valorUnitario.centavos,
          })),
        });
      }
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
          produtos: {
            create: atendimento.produtos.map((p) => ({
              produtoId: p.produtoId,
              quantidade: p.quantidade,
              valorUnitarioCentavos: p.valorUnitario.centavos,
            })),
          },
        },
      });
    }
  }
}
