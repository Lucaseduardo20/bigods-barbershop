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
/**
 * ★ A ordem da comanda é DADO, não sorte (2026-08-25).
 *
 * A tela remove item por POSIÇÃO, e o repositório apaga e recria a lista
 * inteira a cada save (os itens não têm identidade estável). Sem `orderBy`, o
 * Postgres devolve as linhas na ordem que quiser — depois do primeiro save a
 * comanda aparecia embaralhada e "remover o segundo" virava sorteio. Foi o
 * `servicoId` de confirmação que impediu de remover o item errado; esta é a
 * correção da causa.
 *
 * Desempate por `id` para as linhas anteriores à migration, todas com ordem 0:
 * arbitrário, mas ao menos estável entre duas leituras.
 */
const ORDEM_DA_COMANDA = { orderBy: [{ ordem: 'asc' as const }, { id: 'asc' as const }] };

const include = { itens: ORDEM_DA_COMANDA, produtos: ORDEM_DA_COMANDA } as const;

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
      // Comanda editável (2026-08-25). NULL nas linhas anteriores à migration:
      // o domínio cai em `valorCobrado` como base da escada.
      precoCheio: i.precoCheioCentavos === null ? null : Dinheiro.deCentavos(i.precoCheioCentavos),
      precoPromocional:
        i.precoPromocionalCentavos === null ? null : Dinheiro.deCentavos(i.precoPromocionalCentavos),
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
    valorAbatidoSaldo: Dinheiro.deCentavos(row.valorAbatidoSaldoCentavos),
    vendaAbatidaId: row.vendaAbatidaId,
    reservaOnlineExpiraEm: row.reservaOnlineExpiraEm,
    conclusaoAntecipadaMotivo: row.conclusaoAntecipadaMotivo,
    conclusaoSolicitadaPorId: row.conclusaoSolicitadaPorId,
    conclusaoSolicitadaEm: row.conclusaoSolicitadaEm,
    conclusaoFormaPagamento: row.conclusaoFormaPagamento
      ? FormaPagamento[row.conclusaoFormaPagamento]
      : null,
    caixinha: Dinheiro.deCentavos(row.caixinhaCentavos),
    descontoConcedido: Dinheiro.deCentavos(row.descontoConcedidoCentavos),
    reativadoPorId: row.reativadoPorId,
    reativadoEm: row.reativadoEm,
    aprovadoPorId: row.aprovadoPorId,
    aprovadoEm: row.aprovadoEm,
    reatribuidoDeId: row.reatribuidoDeId,
    reatribuidoPorId: row.reatribuidoPorId,
    reatribuidoEm: row.reatribuidoEm,
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
        // CONCLUSAO_PENDENTE ocupa o horário como AGENDADO (2026-08-20) — sem
        // isto, o domínio não veria o conflito e só a constraint EXCLUDE
        // barraria, com erro de banco em vez de mensagem de negócio.
        status: { in: ['AGENDADO', 'RESERVADO', 'CONCLUSAO_PENDENTE'] },
        inicio: { lt: fim },
        fim: { gt: inicio },
      },
      include,
    });
    return rows.map(paraDominio);
  }

  async contarPresenciaisFuturosAtivosDoCliente(clienteId: ClienteId, agora: Date): Promise<number> {
    return this.db.atendimento.count({
      where: {
        clienteId,
        // CONCLUSAO_PENDENTE conta na cota (2026-08-20) pela mesma razão que
        // ocupa o horário: se a recusa devolve o atendimento pra AGENDADO, ele
        // nunca deixou de ser um presencial futuro segurado pelo cliente.
        // AGUARDANDO_APROVACAO conta na cota (2026-09-04): sem isto, a
        // contingência de OTP viraria a porta para entupir a agenda — bastava
        // pedir sem verificar telefone, que é justamente o caminho que a
        // contingência abriu. Um pedido pendente ocupa horário e ocupa cota.
        status: { in: ['AGENDADO', 'CONCLUSAO_PENDENTE', 'AGUARDANDO_APROVACAO'] },
        reservaOnlineExpiraEm: null,
        inicio: { gt: agora },
      },
    });
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
      valorAbatidoSaldoCentavos: atendimento.valorAbatidoSaldo.centavos,
      vendaAbatidaId: atendimento.vendaAbatidaId,
      reservaOnlineExpiraEm: atendimento.reservaOnlineExpiraEm,
      conclusaoAntecipadaMotivo: atendimento.conclusaoAntecipadaMotivo,
      conclusaoSolicitadaPorId: atendimento.conclusaoSolicitadaPorId,
      conclusaoSolicitadaEm: atendimento.conclusaoSolicitadaEm,
      conclusaoFormaPagamento: atendimento.conclusaoFormaPagamento,
      caixinhaCentavos: atendimento.caixinha.centavos,
      descontoConcedidoCentavos: atendimento.descontoConcedido.centavos,
      reativadoPorId: atendimento.reativadoPorId,
      reativadoEm: atendimento.reativadoEm,
      aprovadoPorId: atendimento.aprovadoPorId,
      aprovadoEm: atendimento.aprovadoEm,
      reatribuidoDeId: atendimento.reatribuidoDeId,
      reatribuidoPorId: atendimento.reatribuidoPorId,
      reatribuidoEm: atendimento.reatribuidoEm,
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
          data: atendimento.itens.map((i, ordem) => ({
            atendimentoId: atendimento.id,
            ordem,
            servicoId: i.servicoId,
            valorCobradoCentavos: i.valorCobrado.centavos,
            duracaoMinutos: i.duracao.minutos,
            itemDoPacoteId: i.itemDoPacoteId,
            precoCheioCentavos: i.precoCheio?.centavos ?? null,
            precoPromocionalCentavos: i.precoPromocional?.centavos ?? null,
          })),
        });
      }
      await this.db.itemProdutoAtendido.deleteMany({ where: { atendimentoId: atendimento.id } });
      if (atendimento.produtos.length > 0) {
        await this.db.itemProdutoAtendido.createMany({
          data: atendimento.produtos.map((p, ordem) => ({
            atendimentoId: atendimento.id,
            ordem,
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
            create: atendimento.itens.map((i, ordem) => ({
              ordem,
              servicoId: i.servicoId,
              valorCobradoCentavos: i.valorCobrado.centavos,
              duracaoMinutos: i.duracao.minutos,
              itemDoPacoteId: i.itemDoPacoteId,
              precoCheioCentavos: i.precoCheio?.centavos ?? null,
              precoPromocionalCentavos: i.precoPromocional?.centavos ?? null,
            })),
          },
          produtos: {
            create: atendimento.produtos.map((p, ordem) => ({
              ordem,
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
