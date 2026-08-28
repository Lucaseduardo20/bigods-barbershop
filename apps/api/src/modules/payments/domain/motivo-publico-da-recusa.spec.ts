import { MotivoPublicoDaRecusa } from '@bigods/contracts';
import { describe, expect, it } from 'vitest';
import { motivoPublicoDaRecusa, podeTentarOutroCartao } from './motivo-publico-da-recusa';

/**
 * A garantia: nada de antifraude sai daqui.
 *
 * Cada teste abaixo é uma informação que, entregue ao cliente, ensinaria um
 * fraudador a calibrar a próxima tentativa.
 */

describe('★ o que NÃO pode vazar', () => {
  it('★ high_risk vira GENERICO — jamais "fomos pegos pelo antifraude"', () => {
    expect(motivoPublicoDaRecusa('high_risk')).toBe(MotivoPublicoDaRecusa.GENERICO);
  });

  it('★ max_attempts_exceeded vira GENERICO — não dizemos "espere e volte"', () => {
    expect(motivoPublicoDaRecusa('max_attempts_exceeded')).toBe(MotivoPublicoDaRecusa.GENERICO);
  });

  it('★ nenhum motivo devolvido é o texto cru do gateway', () => {
    const crus = [
      'high_risk',
      'max_attempts_exceeded',
      'rejected_by_issuer',
      'bad_filled_card_data',
      'invalid_card_token',
      'required_call_for_authorize',
      'cc_rejected_3ds_challenge',
      'failed',
    ];
    for (const cru of crus) {
      const publico = motivoPublicoDaRecusa(cru);
      expect(Object.values(MotivoPublicoDaRecusa)).toContain(publico);
      expect(publico).not.toBe(cru);
    }
  });
});

describe('o que o cliente PODE saber, porque é acionável', () => {
  it.each(['bad_filled_card_data', 'invalid_card_token', 'cc_rejected_3ds_challenge'])(
    '%s → DADOS (o cliente relê o cartão e tenta de novo)',
    (detalhe) => {
      expect(motivoPublicoDaRecusa(detalhe)).toBe(MotivoPublicoDaRecusa.DADOS);
    },
  );

  it.each(['rejected_by_issuer', 'required_call_for_authorize'])(
    '%s → EMISSOR (quem decidiu foi o banco dele)',
    (detalhe) => {
      expect(motivoPublicoDaRecusa(detalhe)).toBe(MotivoPublicoDaRecusa.EMISSOR);
    },
  );

  it('motivos de saldo, se o Mercado Pago passar a expô-los, viram SALDO', () => {
    expect(motivoPublicoDaRecusa('insufficient_amount')).toBe(MotivoPublicoDaRecusa.SALDO);
  });
});

describe('★ aqui o default É seguro — ao contrário do mapa de status', () => {
  it('motivo desconhecido cai em GENERICO, sem lançar', () => {
    // Em `mercadopago-status.ts` um default seria perigoso (status novo poderia
    // virar PAGO), então lá desconhecido LANÇA. Aqui é o oposto: a mensagem ao
    // cliente não pode falhar, e GENERICO não revela nada.
    expect(motivoPublicoDaRecusa('motivo_que_o_mp_inventou_amanha')).toBe(
      MotivoPublicoDaRecusa.GENERICO,
    );
    expect(motivoPublicoDaRecusa('')).toBe(MotivoPublicoDaRecusa.GENERICO);
  });

  it('é indiferente a caixa', () => {
    expect(motivoPublicoDaRecusa('HIGH_RISK')).toBe(MotivoPublicoDaRecusa.GENERICO);
    expect(motivoPublicoDaRecusa('Rejected_By_Issuer')).toBe(MotivoPublicoDaRecusa.EMISSOR);
  });
});

describe('podeTentarOutroCartao', () => {
  it('permite nova tentativa na recusa comum', () => {
    for (const d of ['bad_filled_card_data', 'rejected_by_issuer', 'high_risk', 'failed']) {
      expect(podeTentarOutroCartao(d)).toBe(true);
    }
  });

  it('★ bloqueia quando o gateway já disse que estourou o limite de tentativas', () => {
    // Insistir ali só gera outra recusa e piora a leitura de risco da conta.
    expect(podeTentarOutroCartao('max_attempts_exceeded')).toBe(false);
  });
});

describe('★ as duas grafias do gateway dão o MESMO motivo público', () => {
  /*
   * A camada de `order` usa o detalhe curto (`high_risk`), a de
   * `transactions.payments[]` usa `cc_rejected_*`. Aceitamos as duas (ver
   * `mercadopago-status.ts`), então a tradução precisa ser consistente nas duas —
   * senão o MESMO cartão recusado geraria mensagens diferentes para o cliente
   * dependendo de qual camada o gateway resolveu preencher naquele dia.
   */
  it.each([
    ['bad_filled_card_data', 'cc_rejected_bad_filled_security_code'],
    ['rejected_by_issuer', 'cc_rejected_card_disabled'],
    ['required_call_for_authorize', 'cc_rejected_call_for_authorize'],
    ['insufficient_amount', 'cc_rejected_insufficient_amount'],
    ['high_risk', 'cc_rejected_high_risk'],
    ['max_attempts_exceeded', 'cc_rejected_max_attempts'],
  ])('%s e %s caem no mesmo motivo', (curto, longo) => {
    expect(motivoPublicoDaRecusa(longo)).toBe(motivoPublicoDaRecusa(curto));
  });

  it('★ não insistir vale nas duas grafias, e também na blacklist', () => {
    // Insistir depois de `max_attempts` ou de uma lista de bloqueio só gera outra
    // recusa e piora a leitura de risco da NOSSA conta no gateway.
    expect(podeTentarOutroCartao('max_attempts_exceeded')).toBe(false);
    expect(podeTentarOutroCartao('cc_rejected_max_attempts')).toBe(false);
    expect(podeTentarOutroCartao('cc_rejected_blacklist')).toBe(false);
    // Recusa comum segue permitindo outro cartão — a janela é que não renova.
    expect(podeTentarOutroCartao('cc_rejected_insufficient_amount')).toBe(true);
    expect(podeTentarOutroCartao('cc_rejected_high_risk')).toBe(true);
  });

  it('nenhuma grafia nova vira algo diferente de GENERICO por acidente', () => {
    for (const inventado of ['cc_rejected_motivo_novo', 'motivo_que_o_mp_criou_ontem', '']) {
      expect(motivoPublicoDaRecusa(inventado), inventado).toBe(MotivoPublicoDaRecusa.GENERICO);
    }
  });
});
