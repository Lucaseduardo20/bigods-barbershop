import { afterEach, describe, expect, it, vi } from 'vitest';

// O cliente é JS puro sem dependências (roda dentro da Lambda do Cognito, onde
// não há bundler). Importado por caminho relativo justamente para ser testado
// aqui, no mesmo lugar do resto da suíte, sem duplicar a lógica no monólito.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enviarSms, paraE164, SmsGateError, ENDPOINT_PADRAO } = require('../../../../infra/cognito-triggers/sms-gate.js');

/**
 * SMS Gate — o canal de envio do OTP (sessão 2026-08-18).
 *
 * `fetch` é sempre mockado: cada SMS real custa e gasta a franquia do chip da
 * barbearia, então CI nunca dispara envio. O teste com SMS de verdade é
 * MANUAL, no roteiro do RELATORIO_SESSAO.md.
 */

const CONFIG = { usuario: 'user-teste', senha: 'senha-teste' };

function mockarFetch(resposta: Partial<Response> & { jsonBody?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    ok: resposta.ok ?? true,
    status: resposta.status ?? 200,
    json: async () => resposta.jsonBody ?? {},
    text: async () => JSON.stringify(resposta.jsonBody ?? {}),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('paraE164 — o SMS Gate só aceita E.164', () => {
  it('celular nacional com 11 dígitos ganha o +55', () => {
    expect(paraE164('11998887777')).toBe('+5511998887777');
  });

  it('número já em E.164 passa intacto', () => {
    expect(paraE164('+5511998887777')).toBe('+5511998887777');
  });

  it('aceita máscara com espaço, parênteses e traço', () => {
    expect(paraE164('(11) 99888-7777')).toBe('+5511998887777');
  });

  it('fixo de 10 dígitos também é normalizado', () => {
    expect(paraE164('1133334444')).toBe('+551133334444');
  });

  it('recusa vazio e formato improvável em vez de mandar lixo pro gateway', () => {
    expect(() => paraE164('')).toThrow();
    expect(() => paraE164('123')).toThrow();
  });
});

describe('enviarSms — a requisição que chega no SMS Gate', () => {
  it('★ monta POST com Basic Auth, telefone em E.164 e o corpo do PoC', async () => {
    const fetchMock = mockarFetch({ jsonBody: { id: 'msg-1', state: 'Pending' } });

    await enviarSms(CONFIG, { telefone: '11998887777', texto: 'seu codigo e 123456' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT_PADRAO);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('user-teste:senha-teste').toString('base64')}`,
    );
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      textMessage: { text: 'seu codigo e 123456' },
      phoneNumbers: ['+5511998887777'],
    });
  });

  it('devolve id e state do que o cloud aceitou (sem tratar como "entregue")', async () => {
    mockarFetch({ jsonBody: { id: 'msg-42', state: 'Pending' } });
    const r = await enviarSms(CONFIG, { telefone: '+5511998887777', texto: 'x' });
    expect(r).toEqual({ id: 'msg-42', state: 'Pending' });
  });

  it('respeita endpoint customizado (permite apontar pra instância própria)', async () => {
    const fetchMock = mockarFetch({});
    await enviarSms({ ...CONFIG, endpoint: 'https://sms.interno/api' }, { telefone: '11998887777', texto: 'x' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://sms.interno/api');
  });
});

describe('enviarSms — falhas viram erro limpo, nunca exceção crua', () => {
  it('sem credenciais, falha antes de tocar a rede', async () => {
    const fetchMock = mockarFetch({});
    await expect(enviarSms({} as never, { telefone: '11998887777', texto: 'x' })).rejects.toThrow(
      /Credenciais do SMS Gate ausentes/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401 (credencial errada) vira SmsGateError com o status', async () => {
    mockarFetch({ ok: false, status: 401, jsonBody: { message: 'unauthorized' } });
    await expect(enviarSms(CONFIG, { telefone: '11998887777', texto: 'x' })).rejects.toThrow(
      /HTTP 401/,
    );
  });

  it('5xx do gateway também vira erro limpo', async () => {
    mockarFetch({ ok: false, status: 502, jsonBody: {} });
    const erro = await enviarSms(CONFIG, { telefone: '11998887777', texto: 'x' }).catch((e) => e);
    expect(erro).toBeInstanceOf(SmsGateError);
    expect(String(erro.message)).toMatch(/HTTP 502/);
  });

  it('★ device offline / rede caída: erro de fetch vira mensagem limpa, não trava a app', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), { name: 'TypeError' })),
    );
    await expect(enviarSms(CONFIG, { telefone: '11998887777', texto: 'x' })).rejects.toThrow(
      /Falha ao falar com o SMS Gate/,
    );
  });

  it('★ timeout: aborta em vez de segurar a Lambda até o limite dela', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    await expect(
      enviarSms({ ...CONFIG, timeoutMs: 50 }, { telefone: '11998887777', texto: 'x' }),
    ).rejects.toThrow(/sem resposta em 50ms/);
  });

  it('corpo de resposta ilegível não quebra o envio bem-sucedido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
        text: async () => '',
      }),
    );
    await expect(enviarSms(CONFIG, { telefone: '11998887777', texto: 'x' })).resolves.toEqual({
      id: null,
      state: null,
    });
  });
});
