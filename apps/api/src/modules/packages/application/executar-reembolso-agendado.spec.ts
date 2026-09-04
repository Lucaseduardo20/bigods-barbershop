import { BadRequestException } from '@nestjs/common';
import { StatusPagamento, StatusSolicitacaoReembolso } from '@bigods/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chaveDeIdempotencia,
  ExecutarReembolsoAgendadoUseCase,
} from './executar-reembolso-agendado.usecase';
import {
  AgendarReembolsoUseCase,
  CancelarAgendamentoDeReembolsoUseCase,
} from './agendar-reembolso.usecase';
import {
  MAX_TENTATIVAS_DE_ESTORNO,
  SolicitacaoDeReembolso,
} from '../domain/solicitacao-de-reembolso.aggregate';
import { IntencaoDePagamento } from '../../payments/domain/intencao-de-pagamento.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import type { PaymentGateway } from '../../payments/domain/payment-gateway';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import type { ConfigReembolso } from '../../../shared/config/reembolso';

const AGORA = new Date('2026-08-27T12:00:00.000Z');
const VENCIDA = new Date('2026-08-27T11:00:00.000Z');

function solicitacao(): SolicitacaoDeReembolso {
  return SolicitacaoDeReembolso.criar({
    id: 'sol-1',
    companyId: 'co-1',
    vendaDePacoteId: 'venda-1',
    clienteId: 'cli-1',
    // Saldo RESIDUAL — menor que o pagamento original (R$100). O estorno tem de
    // ser parcial; um total devolveria créditos que o cliente já consumiu.
    valor: Dinheiro.deCentavos(4000),
    prazoLimiteEm: new Date('2026-10-11T12:00:00.000Z'),
    hoje: new Date('2026-08-01T12:00:00.000Z'),
  });
}

function intencaoPaga(): IntencaoDePagamento {
  const i = IntencaoDePagamento.criar({
    id: 'int-1',
    companyId: 'co-1',
    referencia: { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: 'venda-1' },
    valor: Dinheiro.deCentavos(10000),
    externalId: 'ext-1',
  });
  i.vincularAoGateway('MERCADOPAGO', 'ORD-1');
  i.confirmarPagamento(Dinheiro.deCentavos(10000));
  return i;
}

/** Mundo em memória: um UoW que devolve sempre os mesmos agregados. */
function mundo(opts: { intencao?: IntencaoDePagamento | null } = {}) {
  const sol = solicitacao();
  const intencao = opts.intencao === undefined ? intencaoPaga() : opts.intencao;
  // O fake precisa de `saldoReservadoReembolso` porque o caso de uso PERGUNTA
  // (`ehPositivo`) em vez de tentar-e-capturar: um `catch` cego ali engoliria a
  // violação da invariante de soma do pacote e deixaria a solicitação
  // REEMBOLSADO com o saldo ainda reservado — foi o que o e2e pegou.
  const venda = {
    saldoReservadoReembolso: Dinheiro.deCentavos(4000),
    confirmarReembolso: vi.fn(function (this: { saldoReservadoReembolso: Dinheiro }) {
      this.saldoReservadoReembolso = Dinheiro.zero();
    }),
    puxarEventos: () => [],
  };
  const repos = {
    solicitacoesReembolso: {
      porId: vi.fn(async () => sol),
      salvar: vi.fn(),
    },
    intencoesDePagamento: {
      porReferenciaVendaDePacote: vi.fn(async () => intencao),
    },
    vendasDePacote: { porId: vi.fn(async () => venda), salvar: vi.fn() },
  };
  const uow = {
    transacao: vi.fn(async (fn: (r: unknown) => Promise<unknown>) => fn(repos)),
  } as unknown as UnitOfWork;
  return { sol, venda, repos, uow };
}

function gatewayFalso(over: Partial<PaymentGateway> = {}) {
  return {
    provedor: 'MERCADOPAGO' as const,
    suportaCartao: true,
    suportaEstorno: true,
    expiraEmSegundos: 1800,
    estornar: vi.fn(async () => ({ estornoId: 'REF-1' })),
    ...over,
  } as unknown as PaymentGateway & { estornar: ReturnType<typeof vi.fn> };
}

describe('★ ExecutarReembolsoAgendadoUseCase', () => {
  let m: ReturnType<typeof mundo>;

  beforeEach(() => {
    m = mundo();
    m.sol.agendar(VENCIDA);
  });

  it('executa e fecha a solicitação como REEMBOLSADO', async () => {
    const gw = gatewayFalso();
    const uc = new ExecutarReembolsoAgendadoUseCase(m.uow, gw);
    const r = await uc.executar({ solicitacaoId: 'sol-1', agora: AGORA });

    expect(r.executado).toBe(true);
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.REEMBOLSADO);
    expect(m.sol.gatewayRefundId).toBe('REF-1');
    expect(m.sol.executadaEm).toEqual(AGORA);
  });

  it('★★ estorno PARCIAL — devolve o saldo residual, não o pagamento inteiro', async () => {
    // A Orders API trata corpo vazio como estorno TOTAL. Sem `valor`, este job
    // devolveria os R$100 do pacote inteiro, incluindo créditos já consumidos.
    const gw = gatewayFalso();
    await new ExecutarReembolsoAgendadoUseCase(m.uow, gw).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    const args = gw.estornar.mock.calls[0]![0];
    expect(args.valor.centavos).toBe(4000);
    expect(args.gatewayId).toBe('ORD-1');
  });

  it('★★ chave de idempotência ESTÁVEL — retentar não devolve duas vezes', async () => {
    // O cenário REAL de retentativa: a primeira chamada estoura por rede (e o
    // gateway pode ter completado do lado dele), a solicitação segue AGENDADO com
    // o backoff, e o próximo tick tenta de novo. As duas chamadas TÊM de levar a
    // mesma chave — sem isso, um job que roda a cada 10 minutos seria uma máquina
    // de devolver dinheiro em dobro, porque a Orders API trata chave nova como
    // pedido novo.
    let primeira = true;
    const gw = gatewayFalso({
      estornar: vi.fn(async () => {
        if (primeira) {
          primeira = false;
          throw new Error('ECONNRESET');
        }
        // 409 `idempotency_key_already_used` traduzido pelo adapter: o estorno já
        // existia, e isso conta como sucesso.
        return { estornoId: 'REF-1', jaExistia: true };
      }),
    } as never);
    const uc = new ExecutarReembolsoAgendadoUseCase(m.uow, gw);

    const falha = await uc.executar({ solicitacaoId: 'sol-1', agora: AGORA });
    expect(falha).toMatchObject({ executado: false, vaiRetentar: true });
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.AGENDADO);

    // O backoff empurrou `agendadaPara`; o tick seguinte acontece depois dela.
    const depois = new Date(m.sol.agendadaPara!.getTime() + 1000);
    const sucesso = await uc.executar({ solicitacaoId: 'sol-1', agora: depois });
    expect(sucesso.executado).toBe(true);

    const chaves = gw.estornar.mock.calls.map((c) => c[0].idempotencyKey);
    expect(chaves).toHaveLength(2);
    expect(new Set(chaves).size).toBe(1);
    expect(chaves[0]).toBe(chaveDeIdempotencia('sol-1'));
  });

  it('★ a chave NÃO colide com a do estorno de pagamento fora da janela', async () => {
    // São devoluções diferentes sobre a MESMA order em potencial: uma é o
    // pagamento tardio inteiro (`estorno-<intencao>`), outra é o saldo residual
    // parcial. Colidir faria a segunda ser silenciosamente ignorada pelo gateway.
    expect(chaveDeIdempotencia('sol-1')).not.toBe('estorno-sol-1');
    expect(chaveDeIdempotencia('sol-1')).toMatch(/^reembolso-/);
  });

  it('★ o gateway é chamado FORA da transação', async () => {
    // Dentro dela, a latência de rede estouraria o timeout de 5s do
    // `$transaction` e viraria rollback — com o dinheiro já tendo saído.
    let dentroDeTransacao = false;
    const gw = gatewayFalso({
      estornar: vi.fn(async () => {
        expect(dentroDeTransacao, 'gateway chamado dentro da transação').toBe(false);
        return { estornoId: 'REF-1' };
      }),
    } as never);
    const uow = {
      transacao: vi.fn(async (fn: (r: unknown) => Promise<unknown>) => {
        dentroDeTransacao = true;
        try {
          return await fn(m.repos);
        } finally {
          dentroDeTransacao = false;
        }
      }),
    } as unknown as UnitOfWork;
    await new ExecutarReembolsoAgendadoUseCase(uow, gw).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
  });

  it('move o saldo reservado do pacote — o mesmo passo do fluxo manual', async () => {
    await new ExecutarReembolsoAgendadoUseCase(m.uow, gatewayFalso()).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    expect(m.venda.confirmarReembolso).toHaveBeenCalledOnce();
    expect(m.venda.saldoReservadoReembolso.centavos).toBe(0);
  });

  it('★★ erro que NÃO é "já movido" PROPAGA — nunca vira sucesso silencioso', async () => {
    // O `catch` cego que existia aqui engolia a violação da invariante de soma do
    // pacote: a solicitação virava REEMBOLSADO, o gateway devolvia o dinheiro, e o
    // saldo continuava reservado oferecendo um abatimento que já não existia.
    // Detectado pelo e2e da Fase 9.
    m.venda.confirmarReembolso.mockImplementation(() => {
      throw new Error('invariante de soma violada');
    });
    await expect(
      new ExecutarReembolsoAgendadoUseCase(m.uow, gatewayFalso()).executar({
        solicitacaoId: 'sol-1',
        agora: AGORA,
      }),
    ).rejects.toThrow(/invariante de soma/);
  });

  it('★ saldo já movido não derruba o registro do estorno (retentativa)', async () => {
    // Reserva zerada = já foi movido numa execução anterior cuja resposta se
    // perdeu. É sucesso, e é detectado por pergunta — não por exceção.
    m.venda.saldoReservadoReembolso = Dinheiro.zero();
    const r = await new ExecutarReembolsoAgendadoUseCase(m.uow, gatewayFalso()).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    expect(r.executado).toBe(true);
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.REEMBOLSADO);
  });

  it('`jaExistia` do gateway conta como sucesso', async () => {
    const gw = gatewayFalso({
      estornar: vi.fn(async () => ({ estornoId: 'REF-1', jaExistia: true })),
    } as never);
    const r = await new ExecutarReembolsoAgendadoUseCase(m.uow, gw).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    expect(r.executado).toBe(true);
  });

  it('★ não vencida ainda: NÃO chama o gateway', async () => {
    m.sol.agendar(new Date('2026-12-01T00:00:00.000Z'));
    const gw = gatewayFalso();
    const r = await new ExecutarReembolsoAgendadoUseCase(m.uow, gw).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    expect(r.executado).toBe(false);
    expect(gw.estornar).not.toHaveBeenCalled();
  });

  it('★★ cancelada entre a varredura e a execução: NÃO executa', async () => {
    // A revalidação dentro da transação existe para isto — a lista do job é uma
    // foto, e agir sobre ela seria agir sobre um estado que já mudou.
    m.sol.cancelarAgendamento();
    const gw = gatewayFalso();
    const r = await new ExecutarReembolsoAgendadoUseCase(m.uow, gw).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    expect(r.executado).toBe(false);
    expect(gw.estornar).not.toHaveBeenCalled();
  });

  it('falha do gateway conta tentativa, guarda o erro e mantém AGENDADO', async () => {
    const gw = gatewayFalso({
      estornar: vi.fn(async () => {
        throw new Error('HTTP 400 (insufficient_funds)');
      }),
    } as never);
    const r = await new ExecutarReembolsoAgendadoUseCase(m.uow, gw).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    expect(r).toMatchObject({ executado: false, vaiRetentar: true });
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.AGENDADO);
    expect(m.sol.tentativas).toBe(1);
    expect(m.sol.ultimoErro).toMatch(/insufficient_funds/);
  });

  it('★★ no teto de tentativas vai para FALHOU — precisa de gente (followup #1)', async () => {
    const gw = gatewayFalso({
      estornar: vi.fn(async () => {
        throw new Error('insufficient_funds');
      }),
    } as never);
    const uc = new ExecutarReembolsoAgendadoUseCase(m.uow, gw);
    for (let i = 0; i < MAX_TENTATIVAS_DE_ESTORNO - 1; i++) {
      m.sol.agendar(VENCIDA); // o backoff empurra a data; o teste reencurta
      await uc.executar({ solicitacaoId: 'sol-1', agora: AGORA });
    }
    // A última tentativa: `agendar` de AGENDADO não zera o contador.
    m.sol.agendar(VENCIDA);
    const r = await uc.executar({ solicitacaoId: 'sol-1', agora: AGORA });
    expect(r.vaiRetentar).toBe(false);
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.FALHOU);
  });

  it('★ sem transação online por trás: falha explícita, não martela o gateway', async () => {
    const semIntencao = mundo({ intencao: null });
    semIntencao.sol.agendar(VENCIDA);
    const gw = gatewayFalso();
    const r = await new ExecutarReembolsoAgendadoUseCase(semIntencao.uow, gw).executar({
      solicitacaoId: 'sol-1',
      agora: AGORA,
    });
    expect(r.executado).toBe(false);
    expect(gw.estornar).not.toHaveBeenCalled();
    expect(semIntencao.sol.ultimoErro).toMatch(/devolva por fora/i);
  });
});

describe('★ AgendarReembolsoUseCase', () => {
  const config: ConfigReembolso = { prazoDiasPadrao: 31 };

  it('agenda com o prazo padrão do deploy', async () => {
    const m = mundo();
    const r = await new AgendarReembolsoUseCase(m.uow, config, gatewayFalso()).executar({
      solicitacaoId: 'sol-1',
      companyId: 'co-1',
      agora: AGORA,
    });
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.AGENDADO);
    expect(r.agendadaPara).toBe('2026-09-27T12:00:00.000Z');
    expect(r.imediato).toBe(false);
  });

  it('★ prazoDias 0 agenda para AGORA — é como "executar já" é expresso', async () => {
    const m = mundo();
    const r = await new AgendarReembolsoUseCase(m.uow, config, gatewayFalso()).executar({
      solicitacaoId: 'sol-1',
      companyId: 'co-1',
      prazoDias: 0,
      agora: AGORA,
    });
    expect(r.imediato).toBe(true);
    expect(m.sol.agendadaPara).toEqual(AGORA);
  });

  it('★★ NÃO chama o gateway, nem com prazo 0 — a execução é só do job', async () => {
    // Um único caminho de execução é o que mantém a chave de idempotência estável
    // e a contagem de tentativas num lugar só.
    const gw = gatewayFalso();
    const m = mundo();
    await new AgendarReembolsoUseCase(m.uow, config, gw).executar({
      solicitacaoId: 'sol-1',
      companyId: 'co-1',
      prazoDias: 0,
      agora: AGORA,
    });
    expect(gw.estornar).not.toHaveBeenCalled();
  });

  it('★ recusa pacote SEM pagamento online — não há o que estornar', async () => {
    const m = mundo({ intencao: null });
    await expect(
      new AgendarReembolsoUseCase(m.uow, config, gatewayFalso()).executar({
        solicitacaoId: 'sol-1',
        companyId: 'co-1',
        agora: AGORA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.PENDENTE);
  });

  it('★ recusa pagamento online AGUARDANDO (nunca foi pago)', async () => {
    const naoPaga = IntencaoDePagamento.criar({
      id: 'int-1',
      companyId: 'co-1',
      referencia: { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: 'venda-1' },
      valor: Dinheiro.deCentavos(10000),
      externalId: 'ext-1',
    });
    expect(naoPaga.status).toBe(StatusPagamento.AGUARDANDO);
    const m = mundo({ intencao: naoPaga });
    await expect(
      new AgendarReembolsoUseCase(m.uow, config, gatewayFalso()).executar({
        solicitacaoId: 'sol-1',
        companyId: 'co-1',
        agora: AGORA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('★ recusa quando o gateway ativo não estorna', async () => {
    const m = mundo();
    const gw = gatewayFalso({ suportaEstorno: false } as never);
    await expect(
      new AgendarReembolsoUseCase(m.uow, config, gw).executar({
        solicitacaoId: 'sol-1',
        companyId: 'co-1',
        agora: AGORA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prazo inválido falha ANTES de abrir transação', async () => {
    const m = mundo();
    await expect(
      new AgendarReembolsoUseCase(m.uow, config, gatewayFalso()).executar({
        solicitacaoId: 'sol-1',
        companyId: 'co-1',
        prazoDias: 999,
        agora: AGORA,
      }),
    ).rejects.toThrow(/Prazo de reembolso inválido/);
    expect(m.uow.transacao).not.toHaveBeenCalled();
  });

  it('company divergente é 404 (não vaza a existência do id)', async () => {
    const m = mundo();
    await expect(
      new AgendarReembolsoUseCase(m.uow, config, gatewayFalso()).executar({
        solicitacaoId: 'sol-1',
        companyId: 'outra',
        agora: AGORA,
      }),
    ).rejects.toThrow(/não encontrada/i);
  });
});

describe('CancelarAgendamentoDeReembolsoUseCase', () => {
  it('volta para PENDENTE', async () => {
    const m = mundo();
    m.sol.agendar(VENCIDA);
    await new CancelarAgendamentoDeReembolsoUseCase(m.uow).executar({
      solicitacaoId: 'sol-1',
      companyId: 'co-1',
    });
    expect(m.sol.status).toBe(StatusSolicitacaoReembolso.PENDENTE);
    expect(m.sol.agendadaPara).toBeNull();
  });

  it('company divergente é 404', async () => {
    const m = mundo();
    m.sol.agendar(VENCIDA);
    await expect(
      new CancelarAgendamentoDeReembolsoUseCase(m.uow).executar({
        solicitacaoId: 'sol-1',
        companyId: 'outra',
      }),
    ).rejects.toThrow(/não encontrada/i);
  });
});
