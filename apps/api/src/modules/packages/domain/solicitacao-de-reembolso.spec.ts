import { StatusSolicitacaoReembolso } from '@bigods/contracts';
import { describe, expect, it } from 'vitest';
import {
  MAX_TENTATIVAS_DE_ESTORNO,
  proximaTentativaEm,
  SolicitacaoDeReembolso,
} from './solicitacao-de-reembolso.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';

const HOJE = new Date('2026-08-27T12:00:00.000Z');
const DEPOIS = new Date('2026-09-27T12:00:00.000Z');

const nova = () =>
  SolicitacaoDeReembolso.criar({
    id: 'sol-1',
    companyId: 'co-1',
    vendaDePacoteId: 'venda-1',
    clienteId: 'cli-1',
    valor: Dinheiro.deCentavos(4000),
    prazoLimiteEm: new Date('2026-10-11T12:00:00.000Z'),
    hoje: HOJE,
  });

/** Já agendada — o estado de onde a execução parte. */
const agendada = () => {
  const s = nova();
  s.agendar(DEPOIS);
  return s;
};

describe('criação (comportamento anterior, não-regressão)', () => {
  it('nasce PENDENTE, sem agendamento e sem tentativas', () => {
    const s = nova();
    expect(s.status).toBe(StatusSolicitacaoReembolso.PENDENTE);
    expect(s.agendadaPara).toBeNull();
    expect(s.tentativas).toBe(0);
    expect(s.ultimoErro).toBeNull();
    expect(s.gatewayRefundId).toBeNull();
  });

  it('recusa valor zero e prazo vencido', () => {
    expect(() =>
      SolicitacaoDeReembolso.criar({
        id: 'x',
        companyId: 'co-1',
        vendaDePacoteId: 'v',
        clienteId: 'c',
        valor: Dinheiro.deCentavos(0),
        prazoLimiteEm: new Date('2026-10-11T12:00:00.000Z'),
        hoje: HOJE,
      }),
    ).toThrow(InvarianteVioladaError);
  });
});

describe('★ agendar — uma transição para os três botões da tela', () => {
  it('de PENDENTE: agenda e guarda a data', () => {
    const s = nova();
    s.agendar(DEPOIS);
    expect(s.status).toBe(StatusSolicitacaoReembolso.AGENDADO);
    expect(s.agendadaPara).toEqual(DEPOIS);
  });

  it('de AGENDADO: antecipar é reagendar para mais cedo', () => {
    const s = agendada();
    const agora = new Date('2026-08-28T00:00:00.000Z');
    s.agendar(agora);
    expect(s.agendadaPara).toEqual(agora);
    expect(s.status).toBe(StatusSolicitacaoReembolso.AGENDADO);
  });

  it('★ de FALHOU: reagendar ZERA tentativas e o último erro', () => {
    // Sem zerar, a solicitação voltaria a FALHOU na primeira falha — e quem
    // reagendou provavelmente resolveu a causa (deixou saldo na conta).
    const s = agendada();
    for (let i = 0; i < MAX_TENTATIVAS_DE_ESTORNO; i++) {
      s.registrarFalhaNaExecucao('saldo insuficiente', DEPOIS);
    }
    expect(s.status).toBe(StatusSolicitacaoReembolso.FALHOU);
    expect(s.tentativas).toBe(MAX_TENTATIVAS_DE_ESTORNO);

    s.agendar(DEPOIS);
    expect(s.status).toBe(StatusSolicitacaoReembolso.AGENDADO);
    expect(s.tentativas).toBe(0);
    expect(s.ultimoErro).toBeNull();
  });

  it('★★ de REEMBOLSADO: RECUSADO — o dinheiro já saiu', () => {
    // É a trava contra devolver o mesmo valor duas vezes por um clique a mais.
    const s = agendada();
    s.registrarEstornoExecutado('REF-1', DEPOIS);
    expect(() => s.agendar(DEPOIS)).toThrow(TransicaoDeEstadoInvalidaError);
  });
});

describe('★ cancelarAgendamento', () => {
  it('volta para PENDENTE e limpa a data', () => {
    const s = agendada();
    s.cancelarAgendamento();
    expect(s.status).toBe(StatusSolicitacaoReembolso.PENDENTE);
    expect(s.agendadaPara).toBeNull();
  });

  it('só de AGENDADO', () => {
    expect(() => nova().cancelarAgendamento()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('★ depois de cancelar, o caminho manual volta a funcionar', () => {
    // É o motivo de esta operação existir: `marcarReembolsada` recusa AGENDADO, e
    // sem uma saída a solicitação ficaria presa até a execução acontecer.
    const s = agendada();
    s.cancelarAgendamento();
    expect(() => s.marcarReembolsada(DEPOIS)).not.toThrow();
    expect(s.status).toBe(StatusSolicitacaoReembolso.REEMBOLSADO);
  });
});

describe('★★ marcarReembolsada recusa AGENDADO — a trava contra pagar duas vezes', () => {
  it('recusa, e a mensagem diz o que fazer', () => {
    const s = agendada();
    expect(() => s.marcarReembolsada(DEPOIS)).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => s.marcarReembolsada(DEPOIS)).toThrow(/cancele o agendamento/i);
  });

  it('★★ de FALHOU PODE — senão um prazo vencido ficaria preso para sempre', () => {
    // `PRAZO_VENCIDO` nunca vai passar pelo gateway. Sem esta saída, a solicitação
    // ficaria em FALHOU eternamente, com o saldo do pacote reservado.
    //
    // Seguro porque FALHOU significa que NENHUM estorno aconteceu: a chave de
    // idempotência é estável, então um sucesso cuja resposta se perdeu voltaria
    // como `jaExistia` na retentativa e viraria REEMBOLSADO, não FALHOU.
    const s = agendada();
    for (let i = 0; i < MAX_TENTATIVAS_DE_ESTORNO; i++) {
      s.registrarFalhaNaExecucao('refund period expired', DEPOIS);
    }
    expect(s.status).toBe(StatusSolicitacaoReembolso.FALHOU);
    s.marcarReembolsada(DEPOIS);
    expect(s.status).toBe(StatusSolicitacaoReembolso.REEMBOLSADO);
    expect(s.reembolsadaEm).toEqual(DEPOIS);
  });

  it('de REEMBOLSADO segue recusado — não fecha duas vezes', () => {
    const s = nova();
    s.marcarReembolsada(DEPOIS);
    expect(() => s.marcarReembolsada(DEPOIS)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('o caminho manual de PENDENTE segue intacto (não-regressão)', () => {
    const s = nova();
    s.marcarReembolsada(DEPOIS);
    expect(s.status).toBe(StatusSolicitacaoReembolso.REEMBOLSADO);
    expect(s.reembolsadaEm).toEqual(DEPOIS);
  });
});

describe('venceu', () => {
  it('só quando AGENDADO e a data já passou', () => {
    const s = agendada();
    expect(s.venceu(new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
    expect(s.venceu(DEPOIS)).toBe(true);
    expect(s.venceu(new Date('2026-10-01T00:00:00.000Z'))).toBe(true);
  });

  it('PENDENTE nunca vence, mesmo sem data', () => {
    expect(nova().venceu(new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('★ cancelado deixa de vencer na mesma hora', () => {
    // É o que impede o job de executar algo que o admin acabou de cancelar.
    const s = agendada();
    s.cancelarAgendamento();
    expect(s.venceu(DEPOIS)).toBe(false);
  });
});

describe('★ registrarEstornoExecutado', () => {
  it('fecha como REEMBOLSADO com o id e a data do gateway', () => {
    const s = agendada();
    s.registrarEstornoExecutado('REF-1', DEPOIS);
    expect(s.status).toBe(StatusSolicitacaoReembolso.REEMBOLSADO);
    expect(s.gatewayRefundId).toBe('REF-1');
    expect(s.executadaEm).toEqual(DEPOIS);
  });

  it('★ preenche reembolsadaEm também — as telas leem esse campo', () => {
    // Sem isto, um estorno automático apareceria sem data para o cliente e para o
    // admin, que já liam `reembolsadaEm` como "quando voltou".
    const s = agendada();
    s.registrarEstornoExecutado('REF-1', DEPOIS);
    expect(s.reembolsadaEm).toEqual(DEPOIS);
  });

  it('★ idempotente para o MESMO id — a retentativa após falha de rede', () => {
    // O gateway pode ter completado e a resposta ter se perdido; a retentativa
    // recebe 409 traduzido em sucesso e chega aqui de novo.
    const s = agendada();
    s.registrarEstornoExecutado('REF-1', DEPOIS);
    expect(() => s.registrarEstornoExecutado('REF-1', DEPOIS)).not.toThrow();
    expect(s.gatewayRefundId).toBe('REF-1');
  });

  it('★★ reapontar para OUTRO id LANÇA — dois ids são duas devoluções', () => {
    const s = agendada();
    s.registrarEstornoExecutado('REF-1', DEPOIS);
    expect(() => s.registrarEstornoExecutado('REF-2', DEPOIS)).toThrow(InvarianteVioladaError);
    expect(s.gatewayRefundId).toBe('REF-1');
  });

  it('de FALHOU também executa — o job pode ter conseguido depois', () => {
    const s = agendada();
    for (let i = 0; i < MAX_TENTATIVAS_DE_ESTORNO; i++) {
      s.registrarFalhaNaExecucao('erro', DEPOIS);
    }
    expect(() => s.registrarEstornoExecutado('REF-1', DEPOIS)).not.toThrow();
  });

  it('de PENDENTE é recusado — não há execução em curso', () => {
    expect(() => nova().registrarEstornoExecutado('REF-1', DEPOIS)).toThrow(
      TransicaoDeEstadoInvalidaError,
    );
  });
});

describe('★ registrarFalhaNaExecucao — retentativa com teto', () => {
  it('conta tentativas, guarda o erro e reagenda', () => {
    const s = agendada();
    expect(s.registrarFalhaNaExecucao('saldo insuficiente', DEPOIS)).toBe(true);
    expect(s.status).toBe(StatusSolicitacaoReembolso.AGENDADO);
    expect(s.tentativas).toBe(1);
    expect(s.ultimoErro).toBe('saldo insuficiente');
    expect(s.agendadaPara!.getTime()).toBeGreaterThan(DEPOIS.getTime());
  });

  it('★★ no teto vira FALHOU e PARA de retentar', () => {
    // Parar é o ponto: o motivo provável (saldo) exige ação humana, e retentar
    // para sempre esconderia isso atrás de um log que ninguém lê (followup #1).
    const s = agendada();
    for (let i = 1; i < MAX_TENTATIVAS_DE_ESTORNO; i++) {
      expect(s.registrarFalhaNaExecucao('saldo insuficiente', DEPOIS), `tentativa ${i}`).toBe(true);
    }
    expect(s.registrarFalhaNaExecucao('saldo insuficiente', DEPOIS)).toBe(false);
    expect(s.status).toBe(StatusSolicitacaoReembolso.FALHOU);
  });

  it('★ FALHOU mantém agendadaPara — é o registro da última tentativa', () => {
    const s = agendada();
    for (let i = 0; i < MAX_TENTATIVAS_DE_ESTORNO; i++) {
      s.registrarFalhaNaExecucao('erro', DEPOIS);
    }
    expect(s.agendadaPara).not.toBeNull();
  });

  it('trunca erro gigante (a coluna não é dump de payload)', () => {
    const s = agendada();
    s.registrarFalhaNaExecucao('x'.repeat(5000), DEPOIS);
    expect(s.ultimoErro!.length).toBeLessThanOrEqual(500);
  });

  it('só de AGENDADO', () => {
    expect(() => nova().registrarFalhaNaExecucao('erro', DEPOIS)).toThrow(
      TransicaoDeEstadoInvalidaError,
    );
  });

  it('já FALHOU não conta mais tentativa (só reagendar reabre)', () => {
    const s = agendada();
    for (let i = 0; i < MAX_TENTATIVAS_DE_ESTORNO; i++) {
      s.registrarFalhaNaExecucao('erro', DEPOIS);
    }
    expect(() => s.registrarFalhaNaExecucao('erro', DEPOIS)).toThrow(
      TransicaoDeEstadoInvalidaError,
    );
  });
});

describe('proximaTentativaEm — backoff', () => {
  it('cresce dobrando a partir de 30 min', () => {
    const base = new Date('2026-08-27T12:00:00.000Z').getTime();
    const minutos = (t: number) => (proximaTentativaEm(new Date(base), t).getTime() - base) / 60_000;
    expect(minutos(1)).toBe(30);
    expect(minutos(2)).toBe(60);
    expect(minutos(3)).toBe(120);
    expect(minutos(4)).toBe(240);
  });

  it('★ tem TETO de 6h — sem ele as 8 tentativas passariam de dois dias', () => {
    const base = new Date('2026-08-27T12:00:00.000Z').getTime();
    const minutos = (t: number) => (proximaTentativaEm(new Date(base), t).getTime() - base) / 60_000;
    expect(minutos(5)).toBe(360);
    expect(minutos(8)).toBe(360);
    expect(minutos(99)).toBe(360);
  });

  it('★ as 8 tentativas cobrem mais de 24 horas', () => {
    // O motivo provável — saldo insuficiente — se resolve em horas. Um teto de
    // tentativas que fechasse em 40 minutos desistiria antes de o dinheiro entrar.
    const base = new Date('2026-08-27T12:00:00.000Z').getTime();
    let total = 0;
    for (let t = 1; t <= MAX_TENTATIVAS_DE_ESTORNO; t++) {
      total += (proximaTentativaEm(new Date(base), t).getTime() - base) / 3_600_000;
    }
    expect(total).toBeGreaterThan(24);
  });
});
