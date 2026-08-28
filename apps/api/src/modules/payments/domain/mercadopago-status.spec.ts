import { StatusPagamento } from '@bigods/contracts';
import { describe, expect, it } from 'vitest';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { combinacoesConhecidas, desfechoDoMercadoPago } from './mercadopago-status';

/**
 * A garantia: nenhum status do Mercado Pago vira PAGO por acidente, e nenhum
 * estorno é interpretado como sucesso.
 *
 * As combinações abaixo foram transcritas das duas tabelas da documentação
 * (order status e transaction status) mais a tabela do guia de 3DS. Se o Mercado
 * Pago publicar um status novo, o teste de desconhecido é o que avisa.
 */

const status = (s: string, d: string) => desfechoDoMercadoPago(s, d);

describe('★ só um caminho leva a PAGO', () => {
  it('processed/accredited é o único "o dinheiro entrou"', () => {
    expect(status('processed', 'accredited')).toEqual({
      tipo: 'MAPEADO',
      status: StatusPagamento.PAGO,
    });
  });

  it('nenhuma outra combinação conhecida devolve PAGO, exceto o estorno parcial', () => {
    const queViraPago = combinacoesConhecidas().filter((chave) => {
      const [s, d] = chave.split('/') as [string, string];
      const r = status(s, d);
      return r.tipo === 'MAPEADO' && r.status === StatusPagamento.PAGO;
    });
    // partially_refunded continua PAGO porque o dinheiro ENTROU — o crédito foi
    // liberado legitimamente e a devolução parcial é decisão do admin.
    // `approved/accredited` é a grafia da camada de PAYMENT do mesmo fato de
    // `processed/accredited` — não é um terceiro caminho, é o mesmo dito de outro
    // jeito (ver a suíte "as DUAS camadas de vocabulário").
    expect(queViraPago.sort()).toEqual([
      'approved/accredited',
      'processed/accredited',
      'processed/partially_refunded',
    ]);
  });
});

describe('aguardando o pagador', () => {
  it.each([
    ['created', 'created'],
    ['action_required', 'waiting_payment'],
    ['action_required', 'waiting_transfer'],
    ['action_required', 'waiting_retry'],
  ])('%s/%s → AGUARDANDO', (s, d) => {
    expect(status(s, d)).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.AGUARDANDO });
  });

  it('★ o desafio 3DS é AGUARDANDO, não EM_ANALISE', () => {
    // Decisão do dono: no desafio o CLIENTE ainda precisa agir, e a janela de 30
    // min segue correndo. EM_ANALISE é quando quem decide é o banco.
    expect(status('action_required', 'pending_challenge')).toEqual({
      tipo: 'MAPEADO',
      status: StatusPagamento.AGUARDANDO,
    });
  });
});

describe('em análise pelo emissor', () => {
  it.each([
    ['processing', 'in_process'],
    ['processing', 'pending_review_manual'],
  ])('%s/%s → EM_ANALISE', (s, d) => {
    expect(status(s, d)).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.EM_ANALISE });
  });

  it('autorizado sem captura vira EM_ANALISE — não é dinheiro nosso ainda', () => {
    // Não deveria ocorrer com capture_mode: automatic. Se ocorrer, é config
    // errada — mas o cliente não falhou e o pagamento não sumiu.
    expect(status('action_required', 'waiting_capture')).toEqual({
      tipo: 'MAPEADO',
      status: StatusPagamento.EM_ANALISE,
    });
  });
});

describe('acabou sem dinheiro', () => {
  it.each([
    ['canceled', 'canceled'],
    ['canceled', 'expired'],
    ['expired', 'expired'],
  ])('%s/%s → EXPIRADO', (s, d) => {
    expect(status(s, d)).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.EXPIRADO });
  });

  it('canceled/expired cobre o estouro do desafio 3DS (40 min sem completar)', () => {
    expect(status('canceled', 'expired')).toEqual({
      tipo: 'MAPEADO',
      status: StatusPagamento.EXPIRADO,
    });
  });
});

describe('recusas de cartão — todas FALHOU, o motivo fica no statusDetalhe', () => {
  it.each([
    ['failed', 'failed'],
    ['failed', 'bad_filled_card_data'],
    ['failed', 'invalid_card_token'],
    ['failed', 'high_risk'],
    ['failed', 'rejected_by_issuer'],
    ['failed', 'required_call_for_authorize'],
    ['failed', 'max_attempts_exceeded'],
    ['failed', 'cc_rejected_3ds_challenge'],
  ])('%s/%s → FALHOU', (s, d) => {
    expect(status(s, d)).toEqual({ tipo: 'MAPEADO', status: StatusPagamento.FALHOU });
  });
});

describe('★ estorno e chargeback NÃO são mapeados — vão para revisão manual', () => {
  /**
   * Este é o grupo que a decisão do dono deixou de fora (estorno segue manual
   * nesta fase). Mapear `refunded` para PAGO manteria um pacote liberado com o
   * dinheiro já devolvido; mapear para FALHOU alegaria que nunca funcionou, e a
   * máquina de estado nem permite sair de PAGO. Devolver REVISAO_MANUAL é a
   * única resposta honesta — o mesmo tratamento do `transparent.lost` da
   * AbacatePay: registra e não toca em entidade nenhuma.
   */
  it.each([
    ['refunded', 'refunded'],
    ['charged_back', 'in_process'],
    ['charged_back', 'settled'],
    ['charged_back', 'reimbursed'],
  ])('%s/%s → REVISAO_MANUAL, com motivo legível', (s, d) => {
    const r = status(s, d);
    expect(r.tipo).toBe('REVISAO_MANUAL');
    if (r.tipo === 'REVISAO_MANUAL') {
      expect(r.motivo.length).toBeGreaterThan(0);
    }
  });

  it('nenhum deles devolve status de pagamento — não há como confirmar por engano', () => {
    for (const [s, d] of [
      ['refunded', 'refunded'],
      ['charged_back', 'settled'],
    ] as const) {
      expect(status(s, d)).not.toHaveProperty('status');
    }
  });
});

describe('★ desconhecido LANÇA — nunca cai num default', () => {
  it.each([
    ['processed', 'inventado'],
    ['status_novo_do_mp', 'accredited'],
    ['', ''],
    ['authorized', 'accredited'],
    ['in_mediation', 'accredited'],
  ])('recusa %s/%s', (s, d) => {
    expect(() => status(s, d)).toThrow(InvarianteVioladaError);
  });

  it('a mensagem diz o que fazer, e mostra a combinação recebida', () => {
    expect(() => status('processed', 'inventado')).toThrow(/processed\/inventado/);
    expect(() => status('processed', 'inventado')).toThrow(/mercadopago-status\.ts/);
  });

  it('★ status conhecido com detalhe novo ainda LANÇA', () => {
    // É a proteção que não pode se perder ao tolerar as duas camadas: aceitar
    // `rejected` como status NÃO significa aceitar qualquer detalhe junto dele.
    expect(() => status('rejected', 'cc_rejected_motivo_que_ainda_nao_existe')).toThrow(
      InvarianteVioladaError,
    );
    expect(() => status('approved', 'detalhe_novo')).toThrow(InvarianteVioladaError);
  });
});

describe('★ as DUAS camadas de vocabulário são aceitas — decisão consciente', () => {
  /*
   * ## Esta suíte REVERTE uma decisão anterior desta mesma sessão
   *
   * A versão original afirmava o contrário: `approved/accredited` e
   * `rejected/*` deviam LANÇAR, "porque são o vocabulário da Payments API legada
   * e apontar o mapa para /v1/payments tem que explodir".
   *
   * O e2e do cartão mostrou o custo dessa escolha. O adapter lê
   * `transactions.payments[0].status` ANTES de `order.status`
   * (`mercadopago.gateway.ts`), e a camada de payment usa `rejected` +
   * `cc_rejected_*`. Com a tabela estrita, **todo cartão recusado** — o desfecho
   * mais comum de um checkout que não é o caminho felizinho — virava um `throw`,
   * que o filtro transformava em **503** para o cliente.
   *
   * ## Por que a proteção original não era o que parecia
   *
   * O que protege contra "interpretar a resposta do endpoint errado" não é esta
   * tabela: é `validarVinculo` (gateway + external_reference + gatewayId) e a
   * checagem de VALOR em `confirmarPagamento`, que roda antes de qualquer
   * transição. Nenhuma leitura de camada errada consegue confirmar um valor que
   * não bate. A tabela protege contra status DESCONHECIDO, e isso continua de pé
   * (ver a suíte acima).
   *
   * ## A assimetria que decide
   *
   * Aceitar e o Mercado Pago nunca mandar → entradas mortas na tabela, custo zero.
   * Recusar e ele mandar → 503 em produção no caminho mais comum de recusa.
   *
   * Mesma disciplina da caixa do `data.id` na assinatura: a documentação mistura
   * as camadas (a tabela já tinha `failed/cc_rejected_3ds_challenge`, uma chave
   * mista, vinda do guia de 3DS) e não permite decidir. Aceita-se as duas.
   *
   * `followup.md` registra: confirmar em staging qual camada chega de fato, e
   * então apagar a metade que não vier.
   */
  it('a camada de payment aprovada também é PAGO', () => {
    expect(status('approved', 'accredited')).toEqual({
      tipo: 'MAPEADO',
      status: StatusPagamento.PAGO,
    });
  });

  it('as recusas cc_rejected_* da camada de payment são FALHOU, não erro', () => {
    for (const d of [
      'cc_rejected_insufficient_amount',
      'cc_rejected_high_risk',
      'cc_rejected_bad_filled_security_code',
      'cc_rejected_call_for_authorize',
      'cc_rejected_max_attempts',
      'cc_rejected_other_reason',
    ]) {
      expect(status('rejected', d), d).toEqual({
        tipo: 'MAPEADO',
        status: StatusPagamento.FALHOU,
      });
    }
  });

  it('as duas grafias do MESMO fato dão o mesmo desfecho', () => {
    expect(status('failed', 'high_risk')).toEqual(status('rejected', 'cc_rejected_high_risk'));
    expect(status('processed', 'accredited')).toEqual(status('approved', 'accredited'));
    expect(status('processing/in_process'.split('/')[0]!, 'in_process')).toEqual(
      status('in_process', 'in_process'),
    );
  });

  it('desafio 3DS na camada de payment também é AGUARDANDO', () => {
    expect(status('pending', 'pending_challenge')).toEqual({
      tipo: 'MAPEADO',
      status: StatusPagamento.AGUARDANDO,
    });
  });
});

describe('cobertura da tabela', () => {
  it('todas as combinações documentadas estão presentes', () => {
    // Transcritas das duas tabelas de status da doc + a tabela do guia de 3DS.
    const documentadas = [
      'created/created',
      'processing/in_process',
      'processing/pending_review_manual',
      'action_required/waiting_payment',
      'action_required/waiting_capture',
      'action_required/waiting_transfer',
      'action_required/waiting_retry',
      'action_required/pending_challenge',
      'processed/accredited',
      'processed/partially_refunded',
      'canceled/canceled',
      'canceled/expired',
      'expired/expired',
      'failed/failed',
      'failed/bad_filled_card_data',
      'failed/invalid_card_token',
      'failed/high_risk',
      'failed/rejected_by_issuer',
      'failed/required_call_for_authorize',
      'failed/max_attempts_exceeded',
      'failed/cc_rejected_3ds_challenge',
      'refunded/refunded',
      'charged_back/in_process',
      'charged_back/settled',
      'charged_back/reimbursed',
    ];
    for (const chave of documentadas) {
      expect(combinacoesConhecidas(), `falta ${chave}`).toContain(chave);
    }
  });

  it('as combinações da camada de PAYMENT também estão presentes', () => {
    // Segunda lista, separada de propósito: são as grafias da camada de
    // `transactions.payments[]`, aceitas por tolerância consciente (ver a suíte
    // "as DUAS camadas de vocabulário"). Manter separadas deixa visível o que é
    // transcrição da doc de order e o que é tolerância.
    const daCamadaDePayment = [
      'approved/accredited',
      'pending/pending_challenge',
      'pending/pending_review_manual',
      'in_process/in_process',
      'in_process/pending_review_manual',
      'rejected/rejected',
      'rejected/cc_rejected_bad_filled_card_number',
      'rejected/cc_rejected_bad_filled_date',
      'rejected/cc_rejected_bad_filled_other',
      'rejected/cc_rejected_bad_filled_security_code',
      'rejected/cc_rejected_blacklist',
      'rejected/cc_rejected_call_for_authorize',
      'rejected/cc_rejected_card_disabled',
      'rejected/cc_rejected_card_error',
      'rejected/cc_rejected_duplicated_payment',
      'rejected/cc_rejected_high_risk',
      'rejected/cc_rejected_insufficient_amount',
      'rejected/cc_rejected_invalid_installments',
      'rejected/cc_rejected_max_attempts',
      'rejected/cc_rejected_other_reason',
      'rejected/cc_rejected_3ds_challenge',
      'rejected/cc_rejected_3ds_mandatory',
      'cancelled/cancelled',
      'cancelled/expired',
    ];
    for (const chave of daCamadaDePayment) {
      expect(combinacoesConhecidas(), `falta ${chave}`).toContain(chave);
    }
  });

  it('★ a tabela não tem entrada a mais que ninguém documentou', () => {
    // O número é um CADEADO, não trivia: bater aqui obriga quem acrescenta uma
    // combinação a passar por uma das duas listas acima e dizer de onde ela veio.
    // 25 da doc de order + 24 da camada de payment.
    expect(combinacoesConhecidas()).toHaveLength(49);
  });
});
