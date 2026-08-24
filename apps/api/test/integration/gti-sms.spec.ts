import { afterEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-var-requires */
const { enviarSms, paraDestinoGti, ENDPOINT_PADRAO } = require('../../../../infra/cognito-triggers/gti-sms.js');

/**
 * Cliente do GTI SMS (2026-08-21) — o provedor que substitui o SMS Gate no OTP.
 *
 * `fetch` sempre mockado: nenhum SMS real sai daqui, e cada envio real custa
 * crédito.
 */

const okDoProvedor = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    status: 'success',
    message: 'Sua mensagem foi enviada com sucesso!',
    data: { uid: '69a956ca027eb', to: '5511988887777', status: 'Delivered', cost: 1 },
    ...extra,
  }),
});

function mockarFetch(resposta: unknown) {
  const fn = vi.fn().mockResolvedValue(resposta);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('paraDestinoGti — o GTI quer DDI sem o "+"', () => {
  it('★ tira o "+" — é a diferença mais fácil de errar entre os dois provedores', () => {
    // O SMS Gate exige "+55..." e recusa sem; este quer "55..." e não entende com.
    expect(paraDestinoGti('+5511988887777')).toBe('5511988887777');
  });

  it('acrescenta o 55 quando vem só DDD + número', () => {
    expect(paraDestinoGti('11988887777')).toBe('5511988887777');
    expect(paraDestinoGti('(11) 98888-7777')).toBe('5511988887777');
  });

  it('formato inesperado falha alto, não vira número torto', () => {
    expect(() => paraDestinoGti('123')).toThrow();
    expect(() => paraDestinoGti('')).toThrow();
  });
});

describe('enviarSms — a requisição que chega no GTI', () => {
  it('POST no endpoint certo, Bearer no header e corpo {recipient, message}', async () => {
    const fetchMock = mockarFetch(okDoProvedor());

    await enviarSms({ token: 'tok-123' }, { telefone: '+5511988887777', texto: 'Seu codigo e 123456' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT_PADRAO);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(init.headers.Accept).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      recipient: '5511988887777',
      message: 'Seu codigo e 123456',
    });
  });

  it('devolve id, status e custo — é o rastro pra procurar no painel do provedor', async () => {
    mockarFetch(okDoProvedor());
    const r = await enviarSms({ token: 't' }, { telefone: '11988887777', texto: 'oi' });
    expect(r).toEqual({ id: '69a956ca027eb', status: 'Delivered', custo: 1 });
  });

  it('sem token não tenta enviar', async () => {
    const fetchMock = mockarFetch(okDoProvedor());
    await expect(enviarSms({}, { telefone: '11988887777', texto: 'oi' })).rejects.toThrow(/GTISMS_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('enviarSms — falhas viram erro limpo, nunca sucesso silencioso', () => {
  it('★ HTTP 200 com status:"error" é FALHA — o provedor sinaliza no corpo', async () => {
    // A armadilha: saldo esgotado e número inválido chegam com 200. Olhar só o
    // código HTTP faria o Cognito apresentar um desafio cujo código nunca saiu,
    // e o cliente ficaria esperando pra sempre.
    mockarFetch({
      ok: true,
      status: 200,
      json: async () => ({ status: 'error', message: 'Insufficient balance' }),
    });
    await expect(enviarSms({ token: 't' }, { telefone: '11988887777', texto: 'oi' })).rejects.toThrow(
      /Insufficient balance/,
    );
  });

  it('corpo vazio ou ilegível também é falha, não sucesso', async () => {
    mockarFetch({ ok: true, status: 200, json: async () => { throw new Error('não é json'); } });
    await expect(enviarSms({ token: 't' }, { telefone: '11988887777', texto: 'oi' })).rejects.toThrow(
      /não enviou/i,
    );
  });

  it('HTTP 4xx/5xx vira erro com o código e o detalhe do provedor', async () => {
    mockarFetch({ ok: false, status: 401, json: async () => ({ message: 'Unauthenticated' }) });
    await expect(enviarSms({ token: 'errado' }, { telefone: '11988887777', texto: 'oi' })).rejects.toThrow(
      /HTTP 401.*Unauthenticated/,
    );
  });

  it('timeout tem mensagem própria — rede lenta não some no meio de um erro genérico', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('abortado'), { name: 'AbortError' })),
    );
    await expect(
      enviarSms({ token: 't', timeoutMs: 50 }, { telefone: '11988887777', texto: 'oi' }),
    ).rejects.toThrow(/sem resposta em 50ms/);
  });
});
