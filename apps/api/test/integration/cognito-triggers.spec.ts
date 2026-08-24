import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-var-requires */
const define = require('../../../../infra/cognito-triggers/define-auth-challenge.js');
const create = require('../../../../infra/cognito-triggers/create-auth-challenge.js');
const verify = require('../../../../infra/cognito-triggers/verify-auth-challenge-response.js');

/**
 * Os 3 Lambda triggers do Custom Auth (sessão 2026-08-18). Rodam na AWS, mas
 * são JS puro sem dependências — dá para exercitá-los aqui, e é o único jeito
 * de saber que o fluxo fecha ANTES de publicar na conta do dono.
 *
 * `fetch` sempre mockado: nenhum SMS real sai daqui.
 */

const TELEFONE = '+5511998887777';

// Env vars que a Lambda `create-auth` recebe no console da AWS. Valores de
// mentira: `fetch` é mockado, nada sai daqui.
beforeEach(() => {
  process.env.SMS_GATE_USER = 'user-teste';
  process.env.SMS_GATE_PASSWORD = 'senha-teste';
});

function eventoCreate(session: unknown[] = []) {
  return {
    request: { session, userAttributes: { phone_number: TELEFONE } },
    response: {} as Record<string, unknown>,
  };
}

function mockarEnvioOk() {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: 'msg-1', state: 'Pending' }),
    text: async () => '{}',
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SMS_GATE_USER;
  delete process.env.SMS_GATE_PASSWORD;
});

describe('CreateAuthChallenge — gera o código e manda o SMS', () => {
  it('★ envia o SMS com um código de 6 dígitos e guarda o esperado fora do alcance do cliente', async () => {
    const fetchMock = mockarEnvioOk();
    const ev = await create.handler(eventoCreate());

    const codigo = (ev.response.privateChallengeParameters as { codigo: string }).codigo;
    expect(codigo).toMatch(/^\d{6}$/);

    // O texto do SMS carrega o mesmo código.
    const corpo = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(corpo.phoneNumbers).toEqual([TELEFONE]);
    expect(corpo.textMessage.text).toContain(codigo);

    // …e o cliente NÃO recebe o código: só o telefone mascarado.
    expect(JSON.stringify(ev.response.publicChallengeParameters)).not.toContain(codigo);
    expect(ev.response.publicChallengeParameters).toEqual({ telefone: '••••7777' });
  });

  it('★ loga o rastro do envio (id, estado, destino mascarado) e NUNCA o código', async () => {
    mockarEnvioOk();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ev = await create.handler(eventoCreate());
    const codigo = (ev.response.privateChallengeParameters as { codigo: string }).codigo;

    const linha = log.mock.calls.map((c) => String(c[0])).join('\n');
    // O que o rastro precisa dar: qual mensagem procurar no painel do SMS Gate,
    // em que estado ela saiu, e pra que número foi (mascarado).
    expect(linha).toContain('sms_enviado');
    expect(linha).toContain('msg-1');
    expect(linha).toContain('Pending');
    expect(linha).toContain('••••7777');
    // ★ CloudWatch é lido por muita gente: OTP em texto claro ali vale tanto
    // quanto senha. Nem o código, nem o telefone inteiro.
    expect(linha).not.toContain(codigo);
    expect(linha).not.toContain(TELEFONE);
  });

  it('★ errar o código NÃO dispara outro SMS — reaproveita o mesmo código da tentativa anterior', async () => {
    const fetchMock = mockarEnvioOk();
    const primeiro = await create.handler(eventoCreate());
    const codigo = (primeiro.response.privateChallengeParameters as { codigo: string }).codigo;

    // Segunda tentativa: o Cognito devolve a sessão com o challengeMetadata.
    const segundo = await create.handler(
      eventoCreate([{ challengeName: 'CUSTOM_CHALLENGE', challengeMetadata: primeiro.response.challengeMetadata }]),
    );

    expect((segundo.response.privateChallengeParameters as { codigo: string }).codigo).toBe(codigo);
    expect(fetchMock).toHaveBeenCalledTimes(1); // ← só o primeiro envio
  });

  it('falha de envio SOBE — nunca apresenta desafio que o cliente não tem como responder', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'nope', json: async () => ({}) }));
    await expect(create.handler(eventoCreate())).rejects.toThrow(/SMS Gate recusou/);
  });

  it('usuário sem telefone falha explicitamente', async () => {
    mockarEnvioOk();
    const ev = { request: { session: [], userAttributes: {} }, response: {} };
    await expect(create.handler(ev)).rejects.toThrow(/sem phone_number/);
  });
});

describe('CreateAuthChallenge — troca de provedor de SMS (2026-08-21)', () => {
  afterEach(() => {
    delete process.env.SMS_PROVIDER;
    delete process.env.GTISMS_TOKEN;
  });

  it('default é o SMS Gate — subir o código novo não muda quem já está em produção', async () => {
    const fetchMock = mockarEnvioOk();
    await create.handler(eventoCreate());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('sms-gate.app');
  });

  it('★ SMS_PROVIDER=gtisms manda pelo GTI — a troca é UMA variável, sem redeploy', async () => {
    process.env.SMS_PROVIDER = 'gtisms';
    process.env.GTISMS_TOKEN = 'tok-abc';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', data: { uid: 'gti-1', status: 'Delivered', cost: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const ev = await create.handler(eventoCreate());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('gtisms.com');
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
    // O código continua sendo o mesmo mecanismo: 6 dígitos, guardado fora do
    // alcance do cliente. Trocar de provedor não mexe em nada disso.
    const codigo = (ev.response.privateChallengeParameters as { codigo: string }).codigo;
    expect(codigo).toMatch(/^\d{6}$/);
    expect(JSON.parse(init.body).message).toContain(codigo);
  });

  it('valor desconhecido falha alto — não cai no default em silêncio', async () => {
    process.env.SMS_PROVIDER = 'twilio';
    mockarEnvioOk();
    await expect(create.handler(eventoCreate())).rejects.toThrow(/SMS_PROVIDER desconhecido/);
  });

  it('★ falha do provedor SOBE — nunca existe desafio sem código entregue', async () => {
    process.env.SMS_PROVIDER = 'gtisms';
    process.env.GTISMS_TOKEN = 'tok-abc';
    // Saldo esgotado chega como HTTP 200 com status:"error".
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'error', message: 'Insufficient balance' }),
      }),
    );
    await expect(create.handler(eventoCreate())).rejects.toThrow(/Insufficient balance/);
  });
});

describe('VerifyAuthChallengeResponse — confere o código', () => {
  it('código certo passa; errado não', async () => {
    const certo = await verify.handler({
      request: { privateChallengeParameters: { codigo: '123456' }, challengeAnswer: '123456' },
      response: {} as Record<string, unknown>,
    });
    expect(certo.response.answerCorrect).toBe(true);

    const errado = await verify.handler({
      request: { privateChallengeParameters: { codigo: '123456' }, challengeAnswer: '000000' },
      response: {} as Record<string, unknown>,
    });
    expect(errado.response.answerCorrect).toBe(false);
  });

  it('sem código esperado (estado inconsistente) nunca autentica', async () => {
    const ev = await verify.handler({
      request: { privateChallengeParameters: undefined, challengeAnswer: '123456' },
      response: {} as Record<string, unknown>,
    });
    expect(ev.response.answerCorrect).toBe(false);
  });
});

describe('DefineAuthChallenge — orquestra o fluxo', () => {
  const rodar = (session: unknown[]) =>
    define.handler({ request: { session }, response: {} as Record<string, unknown> });

  it('primeira chamada apresenta o desafio', async () => {
    const ev = await rodar([]);
    expect(ev.response.challengeName).toBe('CUSTOM_CHALLENGE');
    expect(ev.response.issueTokens).toBe(false);
    expect(ev.response.failAuthentication).toBe(false);
  });

  it('resposta certa emite os tokens', async () => {
    const ev = await rodar([{ challengeName: 'CUSTOM_CHALLENGE', challengeResult: true }]);
    expect(ev.response.issueTokens).toBe(true);
    expect(ev.response.failAuthentication).toBe(false);
  });

  it('erro ainda dentro do limite apresenta o desafio de novo (mesmo código)', async () => {
    const ev = await rodar([{ challengeName: 'CUSTOM_CHALLENGE', challengeResult: false }]);
    expect(ev.response.challengeName).toBe('CUSTOM_CHALLENGE');
    expect(ev.response.failAuthentication).toBe(false);
  });

  it('★ tentativas esgotadas falham a autenticação — não fica tentando pra sempre', async () => {
    const erros = Array(3).fill({ challengeName: 'CUSTOM_CHALLENGE', challengeResult: false });
    const ev = await rodar(erros);
    expect(ev.response.failAuthentication).toBe(true);
    expect(ev.response.issueTokens).toBe(false);
  });
});

describe('Fluxo completo dos três juntos', () => {
  it('★ inicia → recebe SMS → digita o código → autentica', async () => {
    const fetchMock = mockarEnvioOk();

    // 1) Cognito pergunta o que fazer: apresentar desafio.
    const passo1 = await define.handler({ request: { session: [] }, response: {} as Record<string, unknown> });
    expect(passo1.response.challengeName).toBe('CUSTOM_CHALLENGE');

    // 2) Cria o desafio: gera o código e manda o SMS.
    const criado = await create.handler(eventoCreate());
    const codigoEnviado = JSON.parse(fetchMock.mock.calls[0]![1].body).textMessage.text.match(/\d{6}/)![0];

    // 3) Cliente digita o que chegou no SMS.
    const conferido = await verify.handler({
      request: {
        privateChallengeParameters: criado.response.privateChallengeParameters,
        challengeAnswer: codigoEnviado,
      },
      response: {} as Record<string, unknown>,
    });
    expect(conferido.response.answerCorrect).toBe(true);

    // 4) Cognito decide: acertou → emite tokens.
    const final = await define.handler({
      request: { session: [{ challengeName: 'CUSTOM_CHALLENGE', challengeResult: true }] },
      response: {} as Record<string, unknown>,
    });
    expect(final.response.issueTokens).toBe(true);
  });
});
