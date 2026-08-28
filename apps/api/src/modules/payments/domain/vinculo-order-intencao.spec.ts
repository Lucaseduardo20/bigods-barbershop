import { describe, expect, it } from 'vitest';
import {
  DadosDaIntencao,
  DadosDaOrder,
  validarNotificacao,
  validarVinculo,
} from './vinculo-order-intencao';

/**
 * A garantia: uma notificação assinada NÃO confirma qualquer intenção.
 *
 * A assinatura prova origem, não pertencimento. Cada teste aqui é uma confusão
 * de intenção que passaria se a validação fosse só "chegou webhook assinado".
 */

const ORDER_ID = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
const EXTERNAL_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

const order = (over: Partial<DadosDaOrder> = {}): DadosDaOrder => ({
  id: ORDER_ID,
  externalReference: EXTERNAL_ID,
  ...over,
});

const intencao = (over: Partial<DadosDaIntencao> = {}): DadosDaIntencao => ({
  externalId: EXTERNAL_ID,
  gatewayId: ORDER_ID,
  gateway: 'MERCADOPAGO',
  ...over,
});

describe('validarVinculo — a order notificada é DESTA intenção?', () => {
  it('aceita quando os dois critérios batem, sem aviso nenhum', () => {
    expect(validarVinculo(order(), intencao())).toEqual({ ok: true, avisos: [] });
  });

  it('★ recusa external_reference de OUTRA intenção', () => {
    // O ataque: order de R$1 na conta do atacante, com o externalId da vítima.
    const r = validarVinculo(order({ externalReference: 'outro-uuid' }), intencao());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/external_reference/);
  });

  it('★ recusa order cujo id não é o gatewayId gravado', () => {
    const r = validarVinculo(order({ id: 'ORD_OUTRA' }), intencao());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/gatewayId/);
  });

  it('★ recusa intenção criada por OUTRO gateway', () => {
    // Com AbacatePay e Mercado Pago convivendo, uma coincidência de
    // external_reference não pode deixar um confirmar cobrança do outro.
    const r = validarVinculo(order(), intencao({ gateway: 'ABACATEPAY' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/ABACATEPAY/);
  });

  it('recusa também o gateway fake (nunca deve receber webhook real)', () => {
    expect(validarVinculo(order(), intencao({ gateway: 'FAKE' })).ok).toBe(false);
  });

  it('★ NÃO aceita vínculo por um critério só quando os dois estavam disponíveis', () => {
    // external_reference bate, gatewayId não: recusa. É a regra de ouro — casar
    // por um e ignorar o outro é o que abre a confusão.
    const r = validarVinculo(order({ id: 'ORD_DIVERGENTE' }), intencao());
    expect(r.ok).toBe(false);
  });

  describe('linhas antigas — aceitas com ressalva, nunca em silêncio', () => {
    it('intenção sem gatewayId aceita pelo external_reference, com aviso', () => {
      const r = validarVinculo(order(), intencao({ gatewayId: null }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.avisos.join(' ')).toMatch(/gatewayId/);
    });

    it('intenção sem gateway gravado gera aviso, mas não recusa', () => {
      const r = validarVinculo(order(), intencao({ gateway: null }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.avisos.join(' ')).toMatch(/gateway/);
    });

    it('order sem external_reference aceita pelo gatewayId, com aviso', () => {
      const r = validarVinculo(order({ externalReference: undefined }), intencao());
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.avisos.join(' ')).toMatch(/external_reference/);
    });

    it('★ sem external_reference E sem gatewayId: RECUSA — não há critério nenhum', () => {
      // Aceitar aqui seria confiar só em "o webhook chegou", que é exatamente o
      // que a assinatura não garante.
      const r = validarVinculo(order({ externalReference: undefined }), intencao({ gatewayId: null }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toMatch(/critério de vínculo/);
    });

    it('external_reference vazio conta como ausente', () => {
      const r = validarVinculo(order({ externalReference: '' }), intencao());
      expect(r.ok).toBe(true);
    });
  });

  it('não confere VALOR — essa regra é do agregado, não daqui', () => {
    // Documenta a fronteira de propósito: quem garante "entrou o valor certo" é
    // `confirmarPagamento(valorPago)`. Duplicar aqui seria a mesma regra em dois
    // lugares (anti-padrão do CLAUDE.md).
    expect(validarVinculo(order(), intencao()).ok).toBe(true);
  });
});

describe('validarNotificacao — esta notificação é da NOSSA aplicação?', () => {
  const contexto = { applicationId: '76506430185983', userId: '2025701502', ambienteEhProducao: false };

  it('aceita notificação da aplicação e da conta configuradas', () => {
    const r = validarNotificacao(
      { applicationId: '76506430185983', userId: '2025701502', liveMode: false },
      contexto,
    );
    expect(r).toEqual({ ok: true, avisos: [] });
  });

  it('★ recusa application_id de outra aplicação — URL cruzada entre ambientes', () => {
    // O cenário mais provável de todos, e indetectável de outra forma: os dois
    // ambientes usam o mesmo host e tokens com o mesmo prefixo APP_USR-.
    const r = validarNotificacao({ applicationId: '99999', liveMode: false }, contexto);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/ambientes/);
  });

  it('★ recusa live_mode divergente do ambiente configurado', () => {
    const r = validarNotificacao(
      { applicationId: '76506430185983', liveMode: true },
      contexto,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/live_mode/);
  });

  it('aceita live_mode=true quando o ambiente É produção', () => {
    const r = validarNotificacao(
      { applicationId: '76506430185983', liveMode: true },
      { ...contexto, ambienteEhProducao: true },
    );
    expect(r.ok).toBe(true);
  });

  it('recusa user_id de outro vendedor', () => {
    const r = validarNotificacao(
      { applicationId: '76506430185983', userId: '111', liveMode: false },
      contexto,
    );
    expect(r.ok).toBe(false);
  });

  it('campo ausente na notificação gera aviso, não recusa', () => {
    // O MP pode omitir; derrubar pagamento legítimo por campo que a doc não
    // garante é pior que o risco evitado.
    const r = validarNotificacao({}, contexto);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.avisos.length).toBeGreaterThan(0);
  });

  it('instância sem applicationId configurado não recusa por isso', () => {
    const r = validarNotificacao(
      { applicationId: 'qualquer', liveMode: false },
      { ambienteEhProducao: false },
    );
    expect(r.ok).toBe(true);
  });
});
