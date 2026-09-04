import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  MotivoPublicoDaRecusa,
  ResultadoDoCartao,
  StatusPagamento,
} from '@bigods/contracts';
import { describe, expect, it, vi } from 'vitest';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { IntencaoDePagamento } from '../domain/intencao-de-pagamento.aggregate';
import { TentativaDePagamento } from '../domain/tentativa-de-pagamento.aggregate';
import { CobrancaDeCartao, PaymentGateway } from '../domain/payment-gateway';
import { PagarComCartaoUseCase } from './pagar-com-cartao.usecase';

/**
 * As travas de segurança do cartão, testadas com fakes em memória.
 *
 * Fakes e não e2e porque o que importa aqui é o que acontece ENTRE os passos —
 * uma tentativa viva, uma janela estourada, uma falha de rede no meio — e isso um
 * e2e não isola.
 */

const VALOR = Dinheiro.deCentavos(4000);
const INTENCAO_ID = 'int-cartao-1';
const COMPANY = 'co-1';
const AGORA = new Date('2026-08-27T12:00:00.000Z');

function intencao(over: { status?: 'PAGO' | 'FALHOU' | 'EXPIRADO'; expiraEm?: Date } = {}) {
  const i = IntencaoDePagamento.criar({
    id: INTENCAO_ID,
    companyId: COMPANY,
    referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
    valor: VALOR,
    externalId: 'ext-1',
    expiraEm: over.expiraEm ?? new Date('2026-08-27T12:30:00.000Z'),
  });
  if (over.status === 'PAGO') i.confirmarPagamento(VALOR);
  if (over.status === 'FALHOU') i.marcarFalha();
  if (over.status === 'EXPIRADO') i.expirar();
  return i;
}

class RepoIntencoes {
  constructor(public i: IntencaoDePagamento | null) {}
  async porId(id: string) {
    return this.i && this.i.id === id ? this.i : null;
  }
  async porExternalId() {
    return this.i;
  }
  async salvar(i: IntencaoDePagamento) {
    this.i = i;
  }
}
class RepoTentativas {
  lista: TentativaDePagamento[] = [];
  async porId(id: string) {
    return this.lista.find((t) => t.id === id) ?? null;
  }
  async porIntencao() {
    return this.lista;
  }
  async salvar(t: TentativaDePagamento) {
    const i = this.lista.findIndex((x) => x.id === t.id);
    if (i >= 0) this.lista[i] = t;
    else this.lista.push(t);
  }
}

const aprovada: CobrancaDeCartao = {
  gatewayId: 'ORD01ABC',
  desfecho: { tipo: 'MAPEADO', status: StatusPagamento.PAGO },
  statusBruto: 'processed',
  statusDetalheBruto: 'accredited',
  valorPago: VALOR,
  valorLiquido: Dinheiro.deCentavos(3840),
  urlDoDesafio3ds: null,
};

function montar(
  i: IntencaoDePagamento | null,
  pagarComCartao: PaymentGateway['pagarComCartao'],
  tentativasIniciais: TentativaDePagamento[] = [],
) {
  const intencoes = new RepoIntencoes(i);
  const tentativas = new RepoTentativas();
  tentativas.lista = tentativasIniciais;
  const uow = {
    transacao: async <T>(fn: (r: unknown) => Promise<T>) =>
      fn({ intencoesDePagamento: intencoes, tentativasDePagamento: tentativas }),
  };
  const gateway = { provedor: 'MERCADOPAGO', pagarComCartao } as unknown as PaymentGateway;
  const processarWebhook = { executar: vi.fn(async () => ({ processado: true })) };
  return {
    intencoes,
    tentativas,
    processarWebhook,
    caso: new PagarComCartaoUseCase(uow as never, gateway, processarWebhook as never),
  };
}

const entrada = { companyId: COMPANY, intencaoId: INTENCAO_ID, token: 'tok', paymentMethodId: 'master', agora: AGORA };

describe('★ o valor NUNCA vem do cliente', () => {
  it('o valor enviado ao gateway é o da intenção persistida', async () => {
    const pagar = vi.fn(async () => aprovada);
    const { caso } = montar(intencao(), pagar as never);
    await caso.executar(entrada);
    expect(pagar).toHaveBeenCalledWith(expect.objectContaining({ valor: VALOR }));
  });

  it('★ a entrada do caso de uso não tem campo de dinheiro — a ausência é a proteção', () => {
    // Documenta a invariante: se alguém acrescentar `valorCentavos` ao input,
    // este teste vira o lugar onde a discussão acontece.
    expect(Object.keys(entrada)).toEqual([
      'companyId',
      'intencaoId',
      'token',
      'paymentMethodId',
      'agora',
    ]);
  });
});

describe('★ escopo por empresa — 404 genérico, nunca 403', () => {
  it('intenção de outra empresa devolve 404', async () => {
    // 403 confirmaria que o id existe, e o intencaoId é a capability do fluxo.
    const pagar = vi.fn(async () => aprovada);
    const { caso } = montar(intencao(), pagar as never);
    await expect(caso.executar({ ...entrada, companyId: 'outra-co' })).rejects.toThrow(
      NotFoundException,
    );
    expect(pagar).not.toHaveBeenCalled();
  });

  it('intenção inexistente devolve 404', async () => {
    const { caso } = montar(null, vi.fn() as never);
    await expect(caso.executar(entrada)).rejects.toThrow(NotFoundException);
  });
});

describe('★ a janela de 30 min NÃO é renovada', () => {
  it('janela estourada expira a intenção e recusa a cobrança', async () => {
    const pagar = vi.fn(async () => aprovada);
    const { intencoes, caso } = montar(
      intencao({ expiraEm: new Date('2026-08-27T11:00:00.000Z') }),
      pagar as never,
    );
    await expect(caso.executar(entrada)).rejects.toThrow(ConflictException);
    expect(intencoes.i!.status).toBe(StatusPagamento.EXPIRADO);
    expect(pagar).not.toHaveBeenCalled();
  });

  it('★ nova tentativa após recusa mantém a MESMA janela', async () => {
    // Quem gastou 10 dos 30 minutos tem 20 — decisão do dono.
    const expiraEm = new Date('2026-08-27T12:30:00.000Z');
    const pagar = vi.fn(async () => aprovada);
    const { caso } = montar(intencao({ status: 'FALHOU', expiraEm }), pagar as never);
    const r = await caso.executar(entrada);
    expect(r.expiraEm).toBe(expiraEm.toISOString());
  });
});

describe('★ uma tentativa viva por vez — senão dois cartões aprovam', () => {
  it('recusa quando já existe tentativa viva (inclui desafio 3DS pendente)', async () => {
    const viva = TentativaDePagamento.iniciar({
      id: 'tent-viva',
      companyId: COMPANY,
      intencaoDePagamentoId: INTENCAO_ID,
      gateway: 'MERCADOPAGO',
      idempotencyKey: 'k',
      meio: 'CARTAO_CREDITO',
      agora: AGORA,
    });
    const pagar = vi.fn(async () => aprovada);
    const { caso } = montar(intencao(), pagar as never, [viva]);
    await expect(caso.executar(entrada)).rejects.toThrow(ConflictException);
    expect(pagar).not.toHaveBeenCalled();
  });

  it('permite nova tentativa quando a anterior já morreu', async () => {
    const morta = TentativaDePagamento.iniciar({
      id: 'tent-morta',
      companyId: COMPANY,
      intencaoDePagamentoId: INTENCAO_ID,
      gateway: 'MERCADOPAGO',
      idempotencyKey: 'k',
      meio: 'CARTAO_CREDITO',
      agora: AGORA,
    });
    morta.marcarFalhaSemOrder('recusado', AGORA);
    const pagar = vi.fn(async () => aprovada);
    const { caso } = montar(intencao({ status: 'FALHOU' }), pagar as never, [morta]);
    await caso.executar(entrada);
    expect(pagar).toHaveBeenCalledTimes(1);
  });

  it('★ cada tentativa usa chave de idempotência NOVA e persistida', async () => {
    const pagar = vi.fn(async () => aprovada);
    const { tentativas, caso } = montar(intencao(), pagar as never);
    await caso.executar(entrada);
    const chaveUsada = (pagar.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(tentativas.lista[0]!.idempotencyKey).toBe(chaveUsada);
  });
});

describe('desfechos', () => {
  it('aprovado delega ao caminho único de confirmação (que libera pacote/atendimento)', async () => {
    const { processarWebhook, caso } = montar(intencao(), vi.fn(async () => aprovada) as never);
    const r = await caso.executar(entrada);
    expect(r.resultado).toBe(ResultadoDoCartao.APROVADO);
    expect(processarWebhook.executar).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'ext-1', valorPagoCentavos: 4000 }),
    );
  });

  it('★ desafio 3DS devolve a URL e mantém a intenção AGUARDANDO', async () => {
    const comDesafio: CobrancaDeCartao = {
      ...aprovada,
      desfecho: { tipo: 'MAPEADO', status: StatusPagamento.AGUARDANDO },
      statusDetalheBruto: 'pending_challenge',
      urlDoDesafio3ds: 'https://mp/desafio/abc',
    };
    const { intencoes, caso } = montar(intencao(), vi.fn(async () => comDesafio) as never);
    const r = await caso.executar(entrada);
    expect(r.resultado).toBe(ResultadoDoCartao.DESAFIO_3DS);
    expect(r.urlDoDesafio3ds).toBe('https://mp/desafio/abc');
    expect(intencoes.i!.status).toBe(StatusPagamento.AGUARDANDO);
  });

  it('em análise marca EM_ANALISE', async () => {
    const emAnalise: CobrancaDeCartao = {
      ...aprovada,
      desfecho: { tipo: 'MAPEADO', status: StatusPagamento.EM_ANALISE },
      statusDetalheBruto: 'in_process',
    };
    const { intencoes, caso } = montar(intencao(), vi.fn(async () => emAnalise) as never);
    const r = await caso.executar(entrada);
    expect(r.resultado).toBe(ResultadoDoCartao.EM_ANALISE);
    expect(intencoes.i!.status).toBe(StatusPagamento.EM_ANALISE);
  });

  it('★ recusa devolve motivo VAGO — o status_detail cru fica no banco', async () => {
    const recusada: CobrancaDeCartao = {
      ...aprovada,
      desfecho: { tipo: 'MAPEADO', status: StatusPagamento.FALHOU },
      statusDetalheBruto: 'high_risk',
    };
    const { intencoes, caso } = montar(intencao(), vi.fn(async () => recusada) as never);
    const r = await caso.executar(entrada);
    expect(r.resultado).toBe(ResultadoDoCartao.RECUSADO);
    // Nada de antifraude na resposta...
    expect(r.motivoPublico).toBe(MotivoPublicoDaRecusa.GENERICO);
    expect(JSON.stringify(r)).not.toContain('high_risk');
    // ...mas o detalhe cru está persistido para o admin.
    expect(intencoes.i!.statusDetalhe).toBe('high_risk');
  });

  it('limite de tentativas estourado bloqueia nova tentativa', async () => {
    const recusada: CobrancaDeCartao = {
      ...aprovada,
      desfecho: { tipo: 'MAPEADO', status: StatusPagamento.FALHOU },
      statusDetalheBruto: 'max_attempts_exceeded',
    };
    const { caso } = montar(intencao(), vi.fn(async () => recusada) as never);
    const r = await caso.executar(entrada);
    expect(r.podeTentarNovamente).toBe(false);
  });

  it('intenção já PAGA responde APROVADO (idempotente, sem cobrar de novo)', async () => {
    const pagar = vi.fn(async () => aprovada);
    const { caso } = montar(intencao({ status: 'PAGO' }), pagar as never);
    const r = await caso.executar(entrada);
    expect(r.resultado).toBe(ResultadoDoCartao.APROVADO);
    expect(pagar).not.toHaveBeenCalled();
  });
});

describe('★ falha de rede — a tentativa morre, a INTENÇÃO não', () => {
  it('mantém a intenção AGUARDANDO e devolve 503', async () => {
    // Numa falha de rede a order PODE ter sido criada. Marcar a intenção como
    // FALHOU alegaria um desfecho que não conhecemos; quem resolve é o webhook
    // (que acha a intenção pelo external_reference) ou a reconciliação.
    const pagar = vi.fn(async () => {
      throw new Error('timeout');
    });
    const { intencoes, tentativas, caso } = montar(intencao(), pagar as never);
    await expect(caso.executar(entrada)).rejects.toThrow(ServiceUnavailableException);
    expect(intencoes.i!.status).toBe(StatusPagamento.AGUARDANDO);
    expect(tentativas.lista[0]!.status).toBe(StatusPagamento.FALHOU);
    expect(tentativas.lista[0]!.gatewayId).toBeNull();
  });
});
