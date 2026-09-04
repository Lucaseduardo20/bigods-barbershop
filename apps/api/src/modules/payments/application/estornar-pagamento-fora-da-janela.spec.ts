import { StatusPagamento } from '@bigods/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { IntencaoDePagamento } from '../domain/intencao-de-pagamento.aggregate';
import { EstornoRealizado, PaymentGateway } from '../domain/payment-gateway';
import { EstornarPagamentoForaDaJanelaUseCase } from './estornar-pagamento-fora-da-janela.usecase';

/**
 * A garantia: o dinheiro pago fora da janela volta UMA vez, e uma retentativa
 * nunca devolve duas.
 *
 * Este é o caso de uso onde a ordem das operações é o próprio requisito, e por
 * isso ele é testado com fakes em memória em vez de e2e: aqui dá para provar o
 * que acontece se o processo morrer ENTRE dois passos, o que um e2e não alcança.
 */

const VALOR = Dinheiro.deCentavos(4000);
const ID = 'int-estorno-1';

function intencaoExpiradaComGateway(): IntencaoDePagamento {
  const i = IntencaoDePagamento.criar({
    id: ID,
    companyId: 'co-1',
    referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
    valor: VALOR,
    externalId: 'ext-1',
    expiraEm: new Date('2026-08-27T12:00:00.000Z'),
  });
  i.vincularAoGateway('MERCADOPAGO', 'ORD01ABC');
  i.expirar();
  return i;
}

/** Repositório em memória — só o que o caso de uso usa. */
class RepoFake {
  salvamentos = 0;
  constructor(public intencao: IntencaoDePagamento | null) {}
  async porId(id: string) {
    return this.intencao && this.intencao.id === id ? this.intencao : null;
  }
  async salvar(i: IntencaoDePagamento) {
    this.intencao = i;
    this.salvamentos += 1;
  }
}

function montar(intencao: IntencaoDePagamento | null, estornar: PaymentGateway['estornar']) {
  const repo = new RepoFake(intencao);
  const uow = {
    transacao: async <T>(fn: (repos: { intencoesDePagamento: RepoFake }) => Promise<T>) =>
      fn({ intencoesDePagamento: repo }),
  };
  const gateway = { estornar } as unknown as PaymentGateway;
  return {
    repo,
    caso: new EstornarPagamentoForaDaJanelaUseCase(
      uow as never,
      gateway,
    ),
  };
}

const estornoOk = (estornoId = 'REF-1', jaExistia = false) =>
  vi.fn(async (): Promise<EstornoRealizado> => ({ estornoId, jaExistia }));

describe('★ o protocolo de três tempos', () => {
  it('marca, chama o gateway e registra o id — nessa ordem', async () => {
    const intencao = intencaoExpiradaComGateway();
    const estornar = estornoOk('REF-99');
    const { repo, caso } = montar(intencao, estornar);

    const r = await caso.executar({ intencaoId: ID, agora: new Date('2026-08-27T13:00:00.000Z') });

    expect(r).toEqual({ estornado: true });
    expect(estornar).toHaveBeenCalledTimes(1);
    expect(repo.intencao!.estornoSolicitadoEm).toEqual(new Date('2026-08-27T13:00:00.000Z'));
    expect(repo.intencao!.estornoGatewayId).toBe('REF-99');
    expect(repo.intencao!.estornoEmVoo()).toBe(false);
  });

  it('★ usa chave de idempotência ESTÁVEL, derivada da intenção', async () => {
    // Sem isso a retentativa criaria uma SEGUNDA devolução: a Orders API trata
    // chave nova como pedido novo.
    const estornar = estornoOk();
    const { caso } = montar(intencaoExpiradaComGateway(), estornar);
    await caso.executar({ intencaoId: ID });
    expect(estornar).toHaveBeenCalledWith({ gatewayId: 'ORD01ABC', idempotencyKey: `estorno-${ID}` });
  });

  it('a chave estável cabe no limite de 64 caracteres do header', async () => {
    const estornar = estornoOk();
    const { caso } = montar(intencaoExpiradaComGateway(), estornar);
    await caso.executar({ intencaoId: ID });
    const chave = (estornar.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(chave.length).toBeLessThanOrEqual(64);
  });

  it('★ marca ANTES de chamar o gateway — é o que sobrevive a um crash no meio', async () => {
    const intencao = intencaoExpiradaComGateway();
    let marcadoQuandoChamou: Date | null = null;
    const estornar = vi.fn(async () => {
      marcadoQuandoChamou = intencao.estornoSolicitadoEm;
      return { estornoId: 'REF-1' };
    });
    const { caso } = montar(intencao, estornar);
    await caso.executar({ intencaoId: ID, agora: new Date('2026-08-27T13:00:00.000Z') });
    // Se a marcação viesse depois, dois webhooks concorrentes estornariam 2x.
    expect(marcadoQuandoChamou).toEqual(new Date('2026-08-27T13:00:00.000Z'));
  });
});

describe('★ idempotência — a devolução acontece UMA vez', () => {
  it('segunda chamada com estorno já concluído NÃO toca no gateway', async () => {
    const intencao = intencaoExpiradaComGateway();
    const estornar = estornoOk('REF-1');
    const { caso } = montar(intencao, estornar);

    await caso.executar({ intencaoId: ID });
    const r = await caso.executar({ intencaoId: ID });

    expect(estornar).toHaveBeenCalledTimes(1); // ★ uma só
    expect(r.estornado).toBe(false);
    expect(r.motivo).toMatch(/já concluído/);
  });

  it('★ retentativa de estorno EM VOO chama o gateway de novo — e a chave estável protege', async () => {
    // Simula o crash entre T1 e T2: a marcação existe, o id não.
    const intencao = intencaoExpiradaComGateway();
    intencao.solicitarEstornoAutomatico(new Date('2026-08-27T13:00:00.000Z'));
    expect(intencao.estornoEmVoo()).toBe(true);

    const estornar = estornoOk('REF-DEPOIS', true);
    const { repo, caso } = montar(intencao, estornar);
    const r = await caso.executar({ intencaoId: ID });

    expect(estornar).toHaveBeenCalledTimes(1);
    expect(r.estornado).toBe(true);
    expect(repo.intencao!.estornoGatewayId).toBe('REF-DEPOIS');
    expect(repo.intencao!.estornoEmVoo()).toBe(false);
  });

  it('não sobrescreve o instante da primeira solicitação numa retentativa', async () => {
    const intencao = intencaoExpiradaComGateway();
    const primeira = new Date('2026-08-27T13:00:00.000Z');
    intencao.solicitarEstornoAutomatico(primeira);
    const { repo, caso } = montar(intencao, estornoOk());
    await caso.executar({ intencaoId: ID, agora: new Date('2026-08-27T14:00:00.000Z') });
    expect(repo.intencao!.estornoSolicitadoEm).toEqual(primeira);
  });
});

describe('falha do gateway — continua em voo, com o motivo gravado', () => {
  it('★ grava o erro e MANTÉM em voo, para o job repescar', async () => {
    const intencao = intencaoExpiradaComGateway();
    const estornar = vi.fn(async () => {
      throw new Error('saldo insuficiente na conta');
    });
    const { repo, caso } = montar(intencao, estornar as never);

    const r = await caso.executar({ intencaoId: ID });

    expect(r.estornado).toBe(false);
    expect(r.motivo).toMatch(/saldo insuficiente/);
    expect(repo.intencao!.estornoErro).toMatch(/saldo insuficiente/);
    // ★ Continua em voo: é isto que faz o job tentar de novo.
    expect(repo.intencao!.estornoEmVoo()).toBe(true);
  });

  it('sucesso depois de uma falha limpa o erro registrado', async () => {
    const intencao = intencaoExpiradaComGateway();
    const falha = vi.fn(async () => {
      throw new Error('indisponível');
    });
    const { repo, caso } = montar(intencao, falha as never);
    await caso.executar({ intencaoId: ID });
    expect(repo.intencao!.estornoErro).toBeTruthy();

    const { caso: caso2, repo: repo2 } = montar(repo.intencao, estornoOk('REF-OK'));
    await caso2.executar({ intencaoId: ID });
    expect(repo2.intencao!.estornoErro).toBeNull();
    expect(repo2.intencao!.estornoGatewayId).toBe('REF-OK');
  });
});

describe('casos em que não há o que estornar', () => {
  it('intenção inexistente', async () => {
    const estornar = estornoOk();
    const { caso } = montar(null, estornar);
    const r = await caso.executar({ intencaoId: ID });
    expect(r.estornado).toBe(false);
    expect(estornar).not.toHaveBeenCalled();
  });

  it('★ intenção sem gatewayId — linha antiga ou modo manual, nada a estornar lá', async () => {
    const i = IntencaoDePagamento.criar({
      id: ID,
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: VALOR,
      externalId: 'ext-1',
    });
    i.expirar();
    const estornar = estornoOk();
    const { caso } = montar(i, estornar);
    const r = await caso.executar({ intencaoId: ID });
    expect(r.estornado).toBe(false);
    expect(r.motivo).toMatch(/gatewayId/);
    expect(estornar).not.toHaveBeenCalled();
  });

  it('★ intenção PAGA não é estornada — o dinheiro é legitimamente nosso', async () => {
    const i = IntencaoDePagamento.criar({
      id: ID,
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: VALOR,
      externalId: 'ext-1',
    });
    i.vincularAoGateway('MERCADOPAGO', 'ORD01ABC');
    i.confirmarPagamento(VALOR);
    const estornar = estornoOk();
    const { caso } = montar(i, estornar);
    // O agregado recusa: `solicitarEstornoAutomatico` só vale em EXPIRADO/FALHOU.
    await expect(caso.executar({ intencaoId: ID })).rejects.toThrow();
    expect(estornar).not.toHaveBeenCalled();
    expect(i.status).toBe(StatusPagamento.PAGO);
  });
});
