import { describe, expect, it } from 'vitest';
import { taxaRetidaDoPagamento } from './taxa-retida';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import type { ConfigComissaoLiquida } from '../../../shared/config/comissao-liquida';

const SEM_TAXA: ConfigComissaoLiquida = { abacatepayBp: null, mercadopagoBp: null };
const COM_TAXA: ConfigComissaoLiquida = { abacatepayBp: 299, mercadopagoBp: 499 };

const pagamento = (
  bruto: number,
  liquido: number | null,
  gateway: 'ABACATEPAY' | 'MERCADOPAGO' | 'FAKE' | null,
) => ({
  valor: Dinheiro.deCentavos(bruto),
  valorLiquido: liquido === null ? null : Dinheiro.deCentavos(liquido),
  gateway,
});

describe('taxaRetidaDoPagamento', () => {
  it('★ sem pagamento online: taxa zero e CONHECIDA', () => {
    // Presencial, dinheiro, crédito de pacote, saldo residual. Não há taxa, e isso
    // é um fato — não uma configuração faltando.
    expect(taxaRetidaDoPagamento(null, SEM_TAXA)).toEqual({ centavos: 0, conhecida: true });
  });

  it('Mercado Pago com paid_amount: usa o número real da transação', () => {
    expect(taxaRetidaDoPagamento(pagamento(4000, 3840, 'MERCADOPAGO'), COM_TAXA)).toEqual({
      centavos: 160,
      conhecida: true,
    });
  });

  it('★ o líquido informado vence a taxa configurada, mesmo divergindo dela', () => {
    // 4,99% de 4000 seria 200; o gateway informou 160. Ganha o real.
    expect(taxaRetidaDoPagamento(pagamento(4000, 3840, 'MERCADOPAGO'), COM_TAXA).centavos).toBe(160);
  });

  it('AbacatePay sem líquido: cai na taxa configurada', () => {
    // 2,99% de 4000 = 119,6 → 120.
    expect(taxaRetidaDoPagamento(pagamento(4000, null, 'ABACATEPAY'), COM_TAXA)).toEqual({
      centavos: 120,
      conhecida: true,
    });
  });

  it('★ AbacatePay sem líquido E sem taxa: DESCONHECIDA, não zero', () => {
    // É a distinção que faz o handler gritar no log em vez de lançar comissão
    // sobre o bruto em silêncio. Normalmente inalcançável — o boot exige a taxa.
    expect(taxaRetidaDoPagamento(pagamento(4000, null, 'ABACATEPAY'), SEM_TAXA)).toEqual({
      centavos: 0,
      conhecida: false,
    });
  });

  it('★ gateway FAKE tem taxa zero CONHECIDA — não cobra, não retém', () => {
    // Sem isto, todo atendimento pago no ambiente de desenvolvimento entraria no
    // caminho de "taxa desconhecida" e encheria o log de erro falso.
    expect(taxaRetidaDoPagamento(pagamento(4000, null, 'FAKE'), SEM_TAXA)).toEqual({
      centavos: 0,
      conhecida: true,
    });
  });

  it('★ gateway NULL (linha antiga, ou modo manual) também é zero CONHECIDA', () => {
    // Intenções anteriores à coluna `gateway`, e o modo manual por WhatsApp, que
    // não chama gateway nenhum — nesses casos não houve taxa de fato.
    expect(taxaRetidaDoPagamento(pagamento(4000, null, null), SEM_TAXA)).toEqual({
      centavos: 0,
      conhecida: true,
    });
  });

  it('cada gateway usa a SUA taxa, não a do outro', () => {
    const so_abacate: ConfigComissaoLiquida = { abacatepayBp: 299, mercadopagoBp: null };
    expect(taxaRetidaDoPagamento(pagamento(4000, null, 'ABACATEPAY'), so_abacate).centavos).toBe(120);
    expect(taxaRetidaDoPagamento(pagamento(4000, null, 'MERCADOPAGO'), so_abacate).conhecida).toBe(
      false,
    );
  });

  it('taxa configurada ZERO é conhecida e zero (a casa banca)', () => {
    const zero: ConfigComissaoLiquida = { abacatepayBp: 0, mercadopagoBp: 0 };
    expect(taxaRetidaDoPagamento(pagamento(4000, null, 'ABACATEPAY'), zero)).toEqual({
      centavos: 0,
      conhecida: true,
    });
  });

  it('líquido igual ao bruto é taxa zero conhecida', () => {
    expect(taxaRetidaDoPagamento(pagamento(4000, 4000, 'MERCADOPAGO'), COM_TAXA)).toEqual({
      centavos: 0,
      conhecida: true,
    });
  });
});
