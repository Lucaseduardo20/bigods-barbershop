import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificarWebhookMercadoPago } from './mercadopago-webhook.verifier';

/**
 * A garantia: só passa notificação assinada com o NOSSO segredo.
 *
 * ★ Os manifestos aqui são escritos À MÃO, como string literal, e o HMAC é
 * calculado neste arquivo — NUNCA importando `mercadopago-manifesto.ts`. Se o
 * construtor do manifesto tiver um bug (um `;` a menos, ordem trocada), um teste
 * que use o próprio construtor para gerar o esperado passa feliz enquanto a
 * produção responde 401 em toda notificação. É a mesma disciplina que
 * `webhook-abacatepay.e2e.spec.ts` pratica ao duplicar a chave pública em vez de
 * importá-la.
 */

const SEGREDO = 'segredo-do-painel-desta-aplicacao';
const TS = '1742505638683';
const ORDER_ID = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
const REQUEST_ID = '2066ca19-c6f1-498a-be75-1923005edd06';

/** HMAC-SHA256 hex, calculado aqui, sobre a string que o teste montou. */
const assinar = (manifesto: string, segredo = SEGREDO) =>
  createHmac('sha256', segredo).update(manifesto).digest('hex');

const header = (v1: string, ts = TS) => `ts=${ts},v1=${v1}`;

describe('★ verificarWebhookMercadoPago — assinatura válida', () => {
  it('aceita o manifesto com data.id MINÚSCULO (o que a documentação manda)', () => {
    const manifesto = `id:ord01jq4s4ky8hwq6na5pxb65b3d3;request-id:${REQUEST_ID};ts:${TS};`;
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(assinar(manifesto)),
        requestId: REQUEST_ID,
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(true);
  });

  it('★ aceita o manifesto com data.id CRU (o que o SDK oficial faz)', () => {
    // As duas leituras divergem em 100% das notificações, porque todo id de order
    // chega em caixa alta, e a doc não permite decidir qual está certa. Aceitar as
    // duas elimina o risco de 401 universal sem afrouxar nada: o atacante ainda
    // precisa forjar um HMAC válido com o segredo.
    const manifesto = `id:${ORDER_ID};request-id:${REQUEST_ID};ts:${TS};`;
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(assinar(manifesto)),
        requestId: REQUEST_ID,
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(true);
  });

  it('aceita sem x-request-id — a doc manda OMITIR a parte, não falhar', () => {
    const manifesto = `id:ord01jq4s4ky8hwq6na5pxb65b3d3;ts:${TS};`;
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(assinar(manifesto)),
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(true);
  });

  it('ignora chave extra no header (um "v2" futuro não pode derrubar o v1)', () => {
    const manifesto = `id:ord01jq4s4ky8hwq6na5pxb65b3d3;ts:${TS};`;
    const v1 = assinar(manifesto);
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: `ts=${TS},v1=${v1},v2=irrelevante`,
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(true);
  });
});

describe('★ falha fechada — tudo que não prova origem é recusado', () => {
  const manifestoValido = `id:ord01jq4s4ky8hwq6na5pxb65b3d3;ts:${TS};`;
  const v1Valido = assinar(manifestoValido);

  it('recusa sem segredo configurado', () => {
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(v1Valido),
        dataId: ORDER_ID,
        segredo: '',
      }),
    ).toBe(false);
  });

  it('recusa sem header x-signature', () => {
    expect(verificarWebhookMercadoPago({ dataId: ORDER_ID, segredo: SEGREDO })).toBe(false);
  });

  it.each(['', 'lixo', `ts=${TS}`, 'v1=abc', `ts=,v1=${v1Valido}`])(
    'recusa header malformado: %s',
    (h) => {
      expect(
        verificarWebhookMercadoPago({ assinaturaHeader: h, dataId: ORDER_ID, segredo: SEGREDO }),
      ).toBe(false);
    },
  );

  it('recusa ts não-numérico (ele entra no manifesto)', () => {
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: `ts=ontem,v1=${v1Valido}`,
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(false);
  });

  it('★ recusa assinatura feita com OUTRO segredo', () => {
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(assinar(manifestoValido, 'segredo-de-outra-aplicacao')),
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(false);
  });

  it('★ recusa quando o data.id não é o que foi assinado', () => {
    // Trocar o id da order no query param invalida o manifesto — é o que impede
    // reaproveitar uma assinatura legítima para confirmar outra cobrança.
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(v1Valido),
        dataId: 'ORD01OUTRA',
        segredo: SEGREDO,
      }),
    ).toBe(false);
  });

  it('★ recusa quando o ts do header não é o que foi assinado', () => {
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(v1Valido, '1742505999999'),
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(false);
  });

  it('recusa quando havia request-id na assinatura mas ele não veio no header', () => {
    const comRequestId = `id:ord01jq4s4ky8hwq6na5pxb65b3d3;request-id:${REQUEST_ID};ts:${TS};`;
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(assinar(comRequestId)),
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(false);
  });

  it('★ v1 com caractere multibyte NÃO estoura RangeError — recusa limpo', () => {
    // O bug do SDK oficial (issue #459): comparar por CARACTERES deixa passar um
    // v1 de 64 chars com mais de 64 bytes, e o timingSafeEqual lança RangeError,
    // que escapa do catch e vira 500 em vez de 401. O header é hostil.
    const v1Hostil = 'ç'.repeat(64);
    expect(() =>
      verificarWebhookMercadoPago({
        assinaturaHeader: header(v1Hostil),
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).not.toThrow();
    expect(
      verificarWebhookMercadoPago({
        assinaturaHeader: header(v1Hostil),
        dataId: ORDER_ID,
        segredo: SEGREDO,
      }),
    ).toBe(false);
  });
});

describe('tolerância de atraso — desligada por padrão, de propósito', () => {
  const manifesto = `id:ord01jq4s4ky8hwq6na5pxb65b3d3;ts:${TS};`;
  const entradaBase = {
    assinaturaHeader: header(assinar(manifesto)),
    dataId: ORDER_ID,
    segredo: SEGREDO,
  };

  it('★ sem tolerância configurada, assinatura ANTIGA continua válida', () => {
    // A idempotência do ProcessarWebhookUseCase já neutraliza o efeito do replay,
    // e rejeitar por ts velho recusaria webhook legítimo atrasado — com o MP
    // retentando a cada 15 min sem sucesso.
    expect(
      verificarWebhookMercadoPago({ ...entradaBase, agora: () => new Date('2030-01-01') }),
    ).toBe(true);
  });

  it('com tolerância ligada, recusa fora da janela', () => {
    expect(
      verificarWebhookMercadoPago({
        ...entradaBase,
        toleranciaSegundos: 300,
        agora: () => new Date(Number(TS) + 600_000), // 10 min depois
      }),
    ).toBe(false);
  });

  it('com tolerância ligada, aceita dentro da janela', () => {
    expect(
      verificarWebhookMercadoPago({
        ...entradaBase,
        toleranciaSegundos: 300,
        agora: () => new Date(Number(TS) + 60_000), // 1 min depois
      }),
    ).toBe(true);
  });

  it('★ o ts é lido como MILISSEGUNDOS (o SDK oficial erra isso)', () => {
    // Se fosse interpretado como segundos, o instante ficaria ~55 mil anos no
    // futuro e toda notificação legítima cairia fora de qualquer tolerância.
    expect(
      verificarWebhookMercadoPago({
        ...entradaBase,
        toleranciaSegundos: 60,
        agora: () => new Date(Number(TS)),
      }),
    ).toBe(true);
  });

  it('tolerância vale para os dois lados (notificação do futuro também recusa)', () => {
    expect(
      verificarWebhookMercadoPago({
        ...entradaBase,
        toleranciaSegundos: 300,
        agora: () => new Date(Number(TS) - 600_000),
      }),
    ).toBe(false);
  });
});
