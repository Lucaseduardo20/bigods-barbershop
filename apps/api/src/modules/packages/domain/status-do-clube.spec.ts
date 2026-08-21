import { describe, expect, it } from 'vitest';
import { StatusDoClube, StatusItemPacote, StatusPagamento, TipoEventoClube } from '@bigods/contracts';
import {
  AvulsoParaStatus,
  CreditoParaStatus,
  eventoDaTransicao,
  statusDoClube,
} from './status-do-clube';

const t = (dia: number, hora = 12) => new Date(Date.UTC(2026, 7, dia, hora));

const credito = (
  statusDoItem: StatusItemPacote,
  deixouDeViverEm: Date | null = null,
  statusPagamentoDaVenda = StatusPagamento.PAGO,
): CreditoParaStatus => ({ statusPagamentoDaVenda, statusDoItem, deixouDeViverEm });

const avulso = (criadoEm: Date): AvulsoParaStatus => ({ criadoEm });

describe('statusDoClube — os três estados', () => {
  it('crédito DISPONIVEL = MEMBRO_ATIVO', () => {
    expect(statusDoClube({ creditos: [credito(StatusItemPacote.DISPONIVEL)], avulsos: [] })).toBe(
      StatusDoClube.MEMBRO_ATIVO,
    );
  });

  it('nunca teve pacote = NAO_MEMBRO', () => {
    expect(statusDoClube({ creditos: [], avulsos: [avulso(t(1))] })).toBe(StatusDoClube.NAO_MEMBRO);
  });

  it('sem crédito e SEM avulso posterior = MEMBRO_INATIVO — esgotar não expulsa', () => {
    expect(
      statusDoClube({
        creditos: [credito(StatusItemPacote.CONSUMIDO, t(10))],
        avulsos: [],
      }),
    ).toBe(StatusDoClube.MEMBRO_INATIVO);
  });

  /**
   * Este caso já existia e sempre passou — a função pura nunca errou. O bug de
   * produção de 2026-08-21 estava em QUEM ALIMENTA `deixouDeViverEm`: a query
   * derivava o instante do `fim` do atendimento, que fica no futuro quando a
   * conclusão é antecipada. A regressão é coberta no e2e do clube, onde o
   * mapeamento participa.
   */
  it('sem crédito e COM avulso posterior = NAO_MEMBRO', () => {
    expect(
      statusDoClube({
        creditos: [credito(StatusItemPacote.CONSUMIDO, t(10))],
        avulsos: [avulso(t(11))],
      }),
    ).toBe(StatusDoClube.NAO_MEMBRO);
  });

  it('★ pacote ativo PROTEGE: avulso não rebaixa quem tem crédito', () => {
    expect(
      statusDoClube({
        creditos: [credito(StatusItemPacote.DISPONIVEL), credito(StatusItemPacote.CONSUMIDO, t(10))],
        avulsos: [avulso(t(11)), avulso(t(20))],
      }),
    ).toBe(StatusDoClube.MEMBRO_ATIVO);
  });

  it('★ o avulso marcado ENQUANTO havia crédito não volta a assombrar depois', () => {
    // Marcado dia 5, quando ainda havia crédito; o crédito acabou dia 10.
    // Datar pelo `inicio` do atendimento (que podia ser dia 12) rebaixaria
    // injustamente — é por isso que o cálculo usa a MARCAÇÃO.
    expect(
      statusDoClube({
        creditos: [credito(StatusItemPacote.CONSUMIDO, t(10))],
        avulsos: [avulso(t(5))],
      }),
    ).toBe(StatusDoClube.MEMBRO_INATIVO);
  });

  it('renovar de INATIVO/NAO_MEMBRO volta a ATIVO', () => {
    // Comprou de novo: existe crédito vivo, e isso vence qualquer avulso antigo.
    expect(
      statusDoClube({
        creditos: [credito(StatusItemPacote.CONSUMIDO, t(10)), credito(StatusItemPacote.DISPONIVEL)],
        avulsos: [avulso(t(11))],
      }),
    ).toBe(StatusDoClube.MEMBRO_ATIVO);
  });

  it('crédito AGENDADO e SEGUNDA_CHANCE contam como vivos', () => {
    for (const st of [StatusItemPacote.AGENDADO, StatusItemPacote.SEGUNDA_CHANCE]) {
      expect(statusDoClube({ creditos: [credito(st)], avulsos: [avulso(t(30))] })).toBe(
        StatusDoClube.MEMBRO_ATIVO,
      );
    }
  });

  it('pacote NÃO PAGO não faz ninguém membro', () => {
    expect(
      statusDoClube({
        creditos: [credito(StatusItemPacote.DISPONIVEL, null, StatusPagamento.AGUARDANDO)],
        avulsos: [],
      }),
    ).toBe(StatusDoClube.NAO_MEMBRO);
  });

  it('expirado também esgota — e continua inativo, não expulso', () => {
    expect(
      statusDoClube({ creditos: [credito(StatusItemPacote.EXPIRADO, t(10))], avulsos: [] }),
    ).toBe(StatusDoClube.MEMBRO_INATIVO);
  });

  it('compara com o ÚLTIMO crédito a morrer, não com o primeiro', () => {
    // Avulso dia 15 está depois do 1º crédito (dia 10) mas antes do 2º (dia 20):
    // ele foi marcado quando ainda havia crédito → não rebaixa.
    expect(
      statusDoClube({
        creditos: [credito(StatusItemPacote.CONSUMIDO, t(10)), credito(StatusItemPacote.CONSUMIDO, t(20))],
        avulsos: [avulso(t(15))],
      }),
    ).toBe(StatusDoClube.MEMBRO_INATIVO);
  });

  it('sem rastro de quando o crédito morreu, mantém no clube (benefício da dúvida)', () => {
    expect(
      statusDoClube({ creditos: [credito(StatusItemPacote.CONSUMIDO, null)], avulsos: [avulso(t(30))] }),
    ).toBe(StatusDoClube.MEMBRO_INATIVO);
  });
});

describe('eventoDaTransicao — o que vai pro log', () => {
  it('sem mudança, sem evento (é isso que dá idempotência)', () => {
    for (const s of Object.values(StatusDoClube)) {
      expect(eventoDaTransicao({ anterior: s, novo: s, jaFoiMembro: true })).toBeNull();
    }
  });

  it('primeira entrada é ENTROU_CLUBE; voltar é RENOVOU', () => {
    expect(
      eventoDaTransicao({
        anterior: StatusDoClube.NAO_MEMBRO,
        novo: StatusDoClube.MEMBRO_ATIVO,
        jaFoiMembro: false,
      }),
    ).toBe(TipoEventoClube.ENTROU_CLUBE);
    expect(
      eventoDaTransicao({
        anterior: StatusDoClube.NAO_MEMBRO,
        novo: StatusDoClube.MEMBRO_ATIVO,
        jaFoiMembro: true,
      }),
    ).toBe(TipoEventoClube.RENOVOU);
    expect(
      eventoDaTransicao({
        anterior: StatusDoClube.MEMBRO_INATIVO,
        novo: StatusDoClube.MEMBRO_ATIVO,
        jaFoiMembro: true,
      }),
    ).toBe(TipoEventoClube.RENOVOU);
  });

  it('esgotar é VIROU_INATIVO; avulso estando inativo é SAIU_CLUBE', () => {
    expect(
      eventoDaTransicao({
        anterior: StatusDoClube.MEMBRO_ATIVO,
        novo: StatusDoClube.MEMBRO_INATIVO,
        jaFoiMembro: true,
      }),
    ).toBe(TipoEventoClube.VIROU_INATIVO);
    expect(
      eventoDaTransicao({
        anterior: StatusDoClube.MEMBRO_INATIVO,
        novo: StatusDoClube.NAO_MEMBRO,
        jaFoiMembro: true,
      }),
    ).toBe(TipoEventoClube.SAIU_CLUBE);
  });
});
