import { describe, expect, it } from 'vitest';
import { StatusPagamento } from '@bigods/contracts';
import { IntencaoDePagamento } from './intencao-de-pagamento.aggregate';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';

const VALOR = Dinheiro.deCentavos(6000);

const criar = () =>
  IntencaoDePagamento.criar({
    id: 'int-1',
    companyId: 'co-1',
    referencia: { tipo: 'VENDA_DE_PACOTE', vendaDePacoteId: 'pac-1' },
    valor: VALOR,
    externalId: 'ext-abc',
  });

describe('IntencaoDePagamento', () => {
  it('nasce AGUARDANDO', () => {
    expect(criar().status).toBe(StatusPagamento.AGUARDANDO);
  });

  it('confirmação emite PagamentoConfirmado', () => {
    const i = criar();
    expect(i.confirmarPagamento(VALOR)).toBe(true);
    expect(i.status).toBe(StatusPagamento.PAGO);
    expect(i.puxarEventos().map((e) => e.nome)).toEqual(['PagamentoConfirmado']);
  });

  it('confirmação é idempotente: segunda vez é no-op sem evento', () => {
    const i = criar();
    i.confirmarPagamento(VALOR);
    i.puxarEventos();
    expect(i.confirmarPagamento(VALOR)).toBe(false);
    expect(i.puxarEventos()).toEqual([]);
    expect(i.status).toBe(StatusPagamento.PAGO);
  });

  it('intenção expirada não pode ser confirmada', () => {
    const i = criar();
    i.expirar();
    expect(() => i.confirmarPagamento(VALOR)).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('intenção paga não pode expirar nem falhar', () => {
    const i = criar();
    i.confirmarPagamento(VALOR);
    expect(() => i.expirar()).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => i.marcarFalha()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('sem expiraEm (ex.: presencial), expirouPorTempo é sempre false', () => {
    const i = criar();
    expect(i.expiraEm).toBeNull();
    expect(i.expirouPorTempo(new Date(Date.now() + 999_999_999))).toBe(false);
  });

  it('expirouPorTempo é true só quando AGUARDANDO e o prazo local já passou', () => {
    const agora = new Date('2026-08-13T12:00:00.000Z');
    const i = IntencaoDePagamento.criar({
      id: 'int-2',
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: Dinheiro.deCentavos(4000),
      externalId: 'ext-xyz',
      expiraEm: new Date('2026-08-13T12:00:00.000Z'),
    });

    expect(i.expirouPorTempo(new Date(agora.getTime() - 1))).toBe(false); // ainda não chegou o prazo
    expect(i.expirouPorTempo(agora)).toBe(true); // no limite, já expirou
    expect(i.expirouPorTempo(new Date(agora.getTime() + 1))).toBe(true);
  });

  it('expirouPorTempo é false se a intenção já não está mais AGUARDANDO, mesmo com o prazo vencido', () => {
    const i = IntencaoDePagamento.criar({
      id: 'int-3',
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: Dinheiro.deCentavos(4000),
      externalId: 'ext-xyz2',
      expiraEm: new Date('2020-01-01T00:00:00.000Z'), // bem no passado
    });
    i.confirmarPagamento(Dinheiro.deCentavos(4000));
    expect(i.expirouPorTempo(new Date())).toBe(false);
  });
});

/**
 * O pedido do dono, literal: o usuário não pode "assinar um valor e pagar outro".
 *
 * A trava fica no AGREGADO porque é o único ponto por onde TODOS os caminhos de
 * confirmação passam — webhook do gateway, confirmação manual do admin, endpoint
 * de demo. Colocá-la no caso de uso exigiria repetir a mesma regra em cada um, e
 * bastaria um caminho novo esquecer.
 */
describe('★ confirmarPagamento exige o valor pago, e recusa divergência', () => {
  it('recusa valor MENOR que o da intenção', () => {
    const i = criar();
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(100))).toThrow(InvarianteVioladaError);
    expect(i.status).toBe(StatusPagamento.AGUARDANDO);
    expect(i.puxarEventos()).toEqual([]);
  });

  it('recusa valor MAIOR que o da intenção', () => {
    const i = criar();
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(999_999))).toThrow(InvarianteVioladaError);
    expect(i.status).toBe(StatusPagamento.AGUARDANDO);
  });

  it('recusa divergência de UM centavo', () => {
    const i = criar();
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(5999))).toThrow(InvarianteVioladaError);
  });

  it('a mensagem mostra os dois valores e o id da intenção (senão não dá pra investigar)', () => {
    const i = criar();
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(100))).toThrow(/100.*6000|6000.*100/s);
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(100))).toThrow(/int-1/);
  });

  it('★ o valor é conferido ANTES da idempotência: divergência em evento repetido também lança', () => {
    // Não é "no-op inofensivo": divergir num reenvio significa que o evento não é
    // sobre esta intenção, e isso tem que aparecer no log em vez de ser engolido.
    const i = criar();
    i.confirmarPagamento(VALOR);
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(100))).toThrow(InvarianteVioladaError);
    expect(i.status).toBe(StatusPagamento.PAGO); // e nada muda
  });

  it('valor exato confirma, inclusive vindo de outra instância de Dinheiro', () => {
    const i = criar();
    expect(i.confirmarPagamento(Dinheiro.deCentavos(6000))).toBe(true);
  });
});

describe('EM_ANALISE — cartão aceito, emissor ainda decidindo', () => {
  it('AGUARDANDO → EM_ANALISE', () => {
    const i = criar();
    expect(i.marcarEmAnalise()).toBe(true);
    expect(i.status).toBe(StatusPagamento.EM_ANALISE);
  });

  it('é idempotente: marcar duas vezes é no-op', () => {
    const i = criar();
    i.marcarEmAnalise();
    expect(i.marcarEmAnalise()).toBe(false);
  });

  it('★ EM_ANALISE → PAGO: o emissor voltou com "aprovado"', () => {
    const i = criar();
    i.marcarEmAnalise();
    expect(i.confirmarPagamento(VALOR)).toBe(true);
    expect(i.status).toBe(StatusPagamento.PAGO);
    expect(i.puxarEventos().map((e) => e.nome)).toEqual(['PagamentoConfirmado']);
  });

  it('★ EM_ANALISE → FALHOU: o emissor voltou com "não"', () => {
    const i = criar();
    i.marcarEmAnalise();
    i.marcarFalha();
    expect(i.status).toBe(StatusPagamento.FALHOU);
  });

  it('★ EM_ANALISE NÃO expira por tempo — quem está demorando é o emissor, não o cliente', () => {
    const i = IntencaoDePagamento.criar({
      id: 'int-4',
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: VALOR,
      externalId: 'ext-4',
      expiraEm: new Date('2020-01-01T00:00:00.000Z'),
    });
    i.marcarEmAnalise();
    expect(i.expirouPorTempo(new Date())).toBe(false);
    expect(() => i.expirar()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('não se chega a EM_ANALISE de um estado final', () => {
    for (const preparar of [
      (i: IntencaoDePagamento) => i.confirmarPagamento(VALOR),
      (i: IntencaoDePagamento) => i.expirar(),
      (i: IntencaoDePagamento) => i.marcarFalha(),
    ]) {
      const i = criar();
      preparar(i);
      expect(() => i.marcarEmAnalise()).toThrow(TransicaoDeEstadoInvalidaError);
    }
  });
});

describe('vínculo com o gateway', () => {
  it('grava provedor e id da cobrança', () => {
    const i = criar();
    expect(i.gateway).toBeNull();
    expect(i.gatewayId).toBeNull();
    i.vincularAoGateway('MERCADOPAGO', 'ORD01ABC');
    expect(i.gateway).toBe('MERCADOPAGO');
    expect(i.gatewayId).toBe('ORD01ABC');
  });

  it('revincular ao MESMO id é inofensivo (retentativa da mesma criação)', () => {
    const i = criar();
    i.vincularAoGateway('MERCADOPAGO', 'ORD01ABC');
    expect(() => i.vincularAoGateway('MERCADOPAGO', 'ORD01ABC')).not.toThrow();
  });

  it('★ revincular a OUTRO id é recusado — um webhook atrasado confirmaria a cobrança errada', () => {
    const i = criar();
    i.vincularAoGateway('MERCADOPAGO', 'ORD01ABC');
    expect(() => i.vincularAoGateway('MERCADOPAGO', 'ORD01OUTRA')).toThrow(InvarianteVioladaError);
    expect(i.gatewayId).toBe('ORD01ABC');
  });
});

describe('valor líquido — base da comissão em pagamento online', () => {
  it('grava o líquido', () => {
    const i = criar();
    expect(i.valorLiquido).toBeNull();
    i.registrarValorLiquido(Dinheiro.deCentavos(5740));
    expect(i.valorLiquido?.centavos).toBe(5740);
  });

  it('aceita líquido igual ao bruto (PIX com taxa zero, por exemplo)', () => {
    const i = criar();
    expect(() => i.registrarValorLiquido(VALOR)).not.toThrow();
  });

  it('★ recusa líquido MAIOR que o bruto — taxa negativa não existe', () => {
    // Comissionar sobre isso pagaria ao barbeiro mais do que entrou.
    const i = criar();
    expect(() => i.registrarValorLiquido(Dinheiro.deCentavos(6001))).toThrow(InvarianteVioladaError);
    expect(i.valorLiquido).toBeNull();
  });
});

describe('★ estorno automático — o protocolo que impede estornar duas vezes', () => {
  const expirada = () => {
    const i = criar();
    i.expirar();
    return i;
  };

  it('primeira solicitação marca e devolve true', () => {
    const i = expirada();
    const agora = new Date('2026-08-27T12:00:00.000Z');
    expect(i.solicitarEstornoAutomatico(agora)).toBe(true);
    expect(i.estornoSolicitadoEm).toEqual(agora);
  });

  it('★ segunda solicitação devolve FALSE — é este false que impede o estorno duplo', () => {
    // O Mercado Pago retenta o webhook a cada 15 min. Sem esta trava, dois
    // webhooks concorrentes estornariam o mesmo pagamento duas vezes.
    const i = expirada();
    const primeira = new Date('2026-08-27T12:00:00.000Z');
    i.solicitarEstornoAutomatico(primeira);
    expect(i.solicitarEstornoAutomatico(new Date('2026-08-27T12:15:00.000Z'))).toBe(false);
    // E não sobrescreve o instante da primeira.
    expect(i.estornoSolicitadoEm).toEqual(primeira);
  });

  it('vale também para intenção FALHOU', () => {
    const i = criar();
    i.marcarFalha();
    expect(i.solicitarEstornoAutomatico(new Date())).toBe(true);
  });

  it('★ recusa em PAGO — o dinheiro é legitimamente nosso', () => {
    const i = criar();
    i.confirmarPagamento(VALOR);
    expect(() => i.solicitarEstornoAutomatico(new Date())).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('★ recusa em AGUARDANDO — a janela ainda está aberta, não há o que devolver', () => {
    expect(() => criar().solicitarEstornoAutomatico(new Date())).toThrow(
      TransicaoDeEstadoInvalidaError,
    );
  });

  it('recusa em EM_ANALISE — pagamento não confirmado ainda', () => {
    const i = criar();
    i.marcarEmAnalise();
    expect(() => i.solicitarEstornoAutomatico(new Date())).toThrow(TransicaoDeEstadoInvalidaError);
  });
});

describe('★ conclusão do estorno — a diferença entre "pedi" e "devolvi"', () => {
  const emVoo = () => {
    const i = criar();
    i.expirar();
    i.solicitarEstornoAutomatico(new Date('2026-08-27T13:00:00.000Z'));
    return i;
  };

  it('★ estornoEmVoo é true entre o pedido e a confirmação', () => {
    // É este estado que o job de reconciliação varre — e ele existe porque a
    // chamada ao gateway acontece FORA da transação que marcou o pedido.
    const i = emVoo();
    expect(i.estornoEmVoo()).toBe(true);
    i.registrarEstornoExecutado('REF-1');
    expect(i.estornoEmVoo()).toBe(false);
  });

  it('grava o id do estorno e limpa erro anterior', () => {
    const i = emVoo();
    i.registrarFalhaNoEstorno('saldo insuficiente');
    expect(i.estornoErro).toBe('saldo insuficiente');
    i.registrarEstornoExecutado('REF-1');
    expect(i.estornoGatewayId).toBe('REF-1');
    expect(i.estornoErro).toBeNull();
  });

  it('registrar o MESMO id duas vezes é inofensivo (retentativa que achou o estorno feito)', () => {
    const i = emVoo();
    i.registrarEstornoExecutado('REF-1');
    expect(() => i.registrarEstornoExecutado('REF-1')).not.toThrow();
  });

  it('★ registrar id DIFERENTE é recusado — seria uma SEGUNDA devolução', () => {
    const i = emVoo();
    i.registrarEstornoExecutado('REF-1');
    expect(() => i.registrarEstornoExecutado('REF-2')).toThrow(InvarianteVioladaError);
    expect(i.estornoGatewayId).toBe('REF-1');
  });

  it('concluir sem ter solicitado é erro de ordem, não silêncio', () => {
    const i = criar();
    i.expirar();
    expect(() => i.registrarEstornoExecutado('REF-1')).toThrow(TransicaoDeEstadoInvalidaError);
    expect(() => i.registrarFalhaNoEstorno('x')).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('★ falha NÃO tira de voo — é o que garante a retentativa', () => {
    const i = emVoo();
    i.registrarFalhaNoEstorno('indisponível');
    expect(i.estornoEmVoo()).toBe(true);
  });
});

describe('statusDetalhe — diagnóstico do admin, nunca resposta pública', () => {
  it('grava e limpa', () => {
    const i = criar();
    expect(i.statusDetalhe).toBeNull();
    i.registrarStatusDetalhe('waiting_transfer');
    expect(i.statusDetalhe).toBe('waiting_transfer');
    i.registrarStatusDetalhe(null);
    expect(i.statusDetalhe).toBeNull();
  });
});

/**
 * Bugs de máquina de estado encontrados pelo e2e do cartão (2026-08-27).
 *
 * Os dois nasceram da mesma confusão — tratar uma TENTATIVA que falhou como se a
 * INTENÇÃO tivesse falhado — e o segundo é o pior defeito que este recurso
 * poderia ter: dinheiro capturado no emissor e agendamento não confirmado.
 */
describe('★ retentativa de cartão dentro da mesma janela', () => {
  const nova = () =>
    IntencaoDePagamento.criar({
      id: 'int-retry',
      companyId: 'co-1',
      referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
      valor: Dinheiro.deCentavos(4000),
      externalId: 'ext-retry',
      expiraEm: new Date('2026-08-27T13:00:00.000Z'),
    });

  it('★ marcarFalha é IDEMPOTENTE — a 2ª entrega do mesmo webhook não pode estourar', () => {
    // Sem isto, uma reentrega de `failed` responderia 422 e o Mercado Pago
    // retentaria a cada 15 minutos para sempre.
    const i = nova();
    expect(i.marcarFalha()).toBe(true);
    expect(i.marcarFalha()).toBe(false);
    expect(i.status).toBe(StatusPagamento.FALHOU);
  });

  it('★★ FALHOU → PAGO é permitido: é o segundo cartão sendo aprovado', () => {
    // O BUG: recusar esta transição significava capturar o dinheiro no emissor e
    // estourar 422 na confirmação. Cliente cobrado, sem agendamento.
    const i = nova();
    i.marcarFalha();
    expect(i.confirmarPagamento(Dinheiro.deCentavos(4000))).toBe(true);
    expect(i.status).toBe(StatusPagamento.PAGO);
  });

  it('★ mas o VALOR continua sendo verificado antes de qualquer transição', () => {
    // É a checagem de valor — não a rigidez da máquina de estado — que impede
    // "assinar um valor e pagar outro". Ela roda ANTES do teste de status, então
    // abrir FALHOU → PAGO não abriu nada mais.
    const i = nova();
    i.marcarFalha();
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(1))).toThrow(InvarianteVioladaError);
    expect(i.status).toBe(StatusPagamento.FALHOU);
  });

  it('★ EXPIRADO → PAGO segue RECUSADO — ali o horário já voltou para a agenda', () => {
    // A diferença entre FALHOU e EXPIRADO é justamente esta: FALHOU é "a última
    // tentativa não deu, a janela segue"; EXPIRADO é "a janela acabou e a vaga
    // foi devolvida". Confirmar um EXPIRADO daria pagamento sem horário — é o
    // caso que o estorno automático resolve, não a confirmação.
    const i = nova();
    i.expirar();
    expect(() => i.confirmarPagamento(Dinheiro.deCentavos(4000))).toThrow(
      TransicaoDeEstadoInvalidaError,
    );
    expect(i.status).toBe(StatusPagamento.EXPIRADO);
  });

  it('PAGO → marcarFalha continua recusado (dinheiro que entrou não "desfalha")', () => {
    const i = nova();
    i.confirmarPagamento(Dinheiro.deCentavos(4000));
    expect(() => i.marcarFalha()).toThrow(TransicaoDeEstadoInvalidaError);
  });

  it('EM_ANALISE → FALHOU → PAGO: o ciclo completo de um cartão indeciso', () => {
    const i = nova();
    i.marcarEmAnalise();
    expect(i.marcarFalha()).toBe(true);
    expect(i.confirmarPagamento(Dinheiro.deCentavos(4000))).toBe(true);
  });
});
