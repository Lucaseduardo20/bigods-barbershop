import { describe, expect, it } from 'vitest';
import {
  extrairAssinatura,
  manifestosCandidatos,
  montarManifesto,
  tsEhNumerico,
} from './mercadopago-manifesto';

/**
 * A garantia: o manifesto sai byte a byte como o Mercado Pago assina.
 *
 * ★ Os manifestos esperados abaixo são escritos À MÃO, como string literal, NUNCA
 * chamando `montarManifesto`. Se o construtor tiver um bug — um `;` a menos, a
 * ordem trocada — um teste que use o próprio construtor para gerar o esperado
 * passa feliz enquanto a produção responde 401 em toda notificação. É a mesma
 * disciplina que `webhook-abacatepay.e2e.spec.ts` já pratica ao duplicar a chave
 * pública em vez de importá-la.
 */

const TS = '1742505638683';
const ORDER_ID = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
const REQUEST_ID = '2066ca19-c6f1-498a-be75-1923005edd06';

describe('★ montarManifesto — formato exato da documentação', () => {
  it('as três partes, na ordem, com ponto-e-vírgula no fim', () => {
    expect(montarManifesto({ dataId: ORDER_ID, requestId: REQUEST_ID, ts: TS })).toBe(
      'id:ORD01JQ4S4KY8HWQ6NA5PXB65B3D3;request-id:2066ca19-c6f1-498a-be75-1923005edd06;ts:1742505638683;',
    );
  });

  it('★ parte ausente é REMOVIDA, não deixada vazia', () => {
    // `id:…;request-id:;ts:…;` seria uma terceira coisa que ninguém documentou —
    // e daria hash diferente, logo 401.
    expect(montarManifesto({ dataId: ORDER_ID, ts: TS })).toBe(
      'id:ORD01JQ4S4KY8HWQ6NA5PXB65B3D3;ts:1742505638683;',
    );
    expect(montarManifesto({ requestId: REQUEST_ID, ts: TS })).toBe(
      'request-id:2066ca19-c6f1-498a-be75-1923005edd06;ts:1742505638683;',
    );
  });

  it('só o ts ainda produz manifesto válido, com o ponto-e-vírgula final', () => {
    expect(montarManifesto({ ts: TS })).toBe('ts:1742505638683;');
  });

  it('string vazia conta como ausente (nunca vira "id:;")', () => {
    expect(montarManifesto({ dataId: '', requestId: '', ts: TS })).toBe('ts:1742505638683;');
  });

  it('NÃO mexe na caixa do dataId — quem decide isso é manifestosCandidatos', () => {
    expect(montarManifesto({ dataId: ORDER_ID, ts: TS })).toContain('id:ORD01');
  });
});

describe('★ manifestosCandidatos — a divergência de caixa entre doc e SDK', () => {
  it('gera as DUAS variantes quando o id tem maiúsculas: minúsculo primeiro, cru depois', () => {
    const candidatos = manifestosCandidatos({ dataId: ORDER_ID, requestId: REQUEST_ID, ts: TS });
    expect(candidatos).toEqual([
      'id:ord01jq4s4ky8hwq6na5pxb65b3d3;request-id:2066ca19-c6f1-498a-be75-1923005edd06;ts:1742505638683;',
      'id:ORD01JQ4S4KY8HWQ6NA5PXB65B3D3;request-id:2066ca19-c6f1-498a-be75-1923005edd06;ts:1742505638683;',
    ]);
  });

  it('★ o minúsculo vem primeiro — é o que a documentação manda', () => {
    // Ordem importa para diagnóstico: quando descobrirmos qual variante o MP usa
    // de fato, saber qual bateu primeiro é o que permite simplificar depois.
    const [primeiro] = manifestosCandidatos({ dataId: ORDER_ID, ts: TS });
    expect(primeiro).toContain('id:ord01');
  });

  it('gera UM só candidato quando o id já é minúsculo (não confere a mesma string 2x)', () => {
    const candidatos = manifestosCandidatos({ dataId: 'pay01abc', ts: TS });
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0]).toBe('id:pay01abc;ts:1742505638683;');
  });

  it('gera UM só candidato quando não há dataId', () => {
    expect(manifestosCandidatos({ requestId: REQUEST_ID, ts: TS })).toHaveLength(1);
  });

  it('id só com dígitos não gera variante duplicada', () => {
    expect(manifestosCandidatos({ dataId: '123456', ts: TS })).toHaveLength(1);
  });
});

describe('extrairAssinatura — header x-signature', () => {
  it('lê ts e v1 do formato da documentação', () => {
    expect(
      extrairAssinatura('ts=1742505638683,v1=ced36ab6d33566bb1e16c125819b8d840d6b8ef136b0b9127c76064466f5229b'),
    ).toEqual({
      ts: '1742505638683',
      v1: 'ced36ab6d33566bb1e16c125819b8d840d6b8ef136b0b9127c76064466f5229b',
    });
  });

  it('tolera espaço em volta das partes', () => {
    expect(extrairAssinatura(' ts = 1742505638683 , v1 = abc ')).toEqual({
      ts: '1742505638683',
      v1: 'abc',
    });
  });

  it('ignora chave desconhecida — um "v2" futuro não pode derrubar o v1 que funciona', () => {
    expect(extrairAssinatura('ts=1,v1=abc,v2=def,lixo')).toEqual({ ts: '1', v1: 'abc' });
  });

  it('★ não trunca valor que contenha "=" (base64)', () => {
    expect(extrairAssinatura('ts=1,v1=YWJjZA==').v1).toBe('YWJjZA==');
  });

  it.each([undefined, '', 'lixo', 'ts=1', 'v1=abc'])('devolve ausente como undefined em %s', (h) => {
    const r = extrairAssinatura(h);
    expect(r.ts === undefined || r.v1 === undefined).toBe(true);
  });
});

describe('tsEhNumerico — o ts vem em MILISSEGUNDOS', () => {
  it('aceita o epoch de 13 dígitos do exemplo da doc', () => {
    expect(tsEhNumerico('1742505638683')).toBe(true);
  });

  it.each([undefined, '', 'abc', '17425.38', '-1742505638683', '1e12'])('recusa %s', (ts) => {
    expect(tsEhNumerico(ts)).toBe(false);
  });
});
