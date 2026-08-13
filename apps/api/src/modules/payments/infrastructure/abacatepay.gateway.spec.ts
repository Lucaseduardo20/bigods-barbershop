import { describe, expect, it, vi } from 'vitest';
import { AbacatePayGateway, FetchLike } from './abacatepay.gateway';
import { Dinheiro } from '../../../shared/domain/dinheiro';

const config = { apiKey: 'key-abc', baseUrl: 'https://api.abacatepay.com/v2', expiraEmSegundos: 3600 };

function respostaOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('AbacatePayGateway (fetch mockado) — Checkout Transparente v2', () => {
  it('cria cobrança PIX e mapeia brCode/brCodeBase64/expiresAt → copiaECola/qrCode/expiresAt', async () => {
    const fetchFn = vi.fn(async () =>
      respostaOk({
        data: {
          id: 'pix_1',
          brCode: '00020126-COPIA',
          brCodeBase64: 'data:image/png;base64,QR',
          status: 'PENDING',
          expiresAt: '2026-08-13T20:00:00.000Z',
        },
      }),
    ) as unknown as FetchLike;
    const gateway = new AbacatePayGateway(config, fetchFn);

    const cobranca = await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(4000),
      descricao: 'Pacote X',
      externalId: 'ext-42',
    });

    expect(cobranca).toEqual({
      gatewayId: 'pix_1',
      qrCode: 'data:image/png;base64,QR',
      copiaECola: '00020126-COPIA',
      expiresAt: new Date('2026-08-13T20:00:00.000Z'),
    });
  });

  it('chama POST /transparents/create com externalId DIRETO em data (não em metadata), valor em centavos e Bearer da API key', async () => {
    const fetchFn = vi.fn(async () =>
      respostaOk({ data: { id: 'p', brCode: 'c', brCodeBase64: 'q', status: 'PENDING', expiresAt: '2026-08-13T20:00:00.000Z' } }),
    );
    const gateway = new AbacatePayGateway(config, fetchFn as unknown as FetchLike);

    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(4000), descricao: 'Pacote X', externalId: 'ext-42' });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.abacatepay.com/v2/transparents/create');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-abc');
    const enviado = JSON.parse(init.body as string);
    expect(enviado.method).toBe('PIX');
    expect(enviado.data.amount).toBe(4000);
    expect(enviado.data.expiresIn).toBe(3600);
    expect(enviado.data.description).toBe('Pacote X');
    // v2 real: externalId é campo direto de `data`, NUNCA aninhado em metadata.
    expect(enviado.data.externalId).toBe('ext-42');
    expect(enviado.data.metadata).toBeUndefined();
  });

  it('propaga erro quando a API responde com error no corpo', async () => {
    const fetchFn = vi.fn(async () => respostaOk({ error: 'saldo insuficiente' }));
    const gateway = new AbacatePayGateway(config, fetchFn as unknown as FetchLike);
    await expect(
      gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' }),
    ).rejects.toThrow(/AbacatePay/);
  });

  it('propaga erro em HTTP não-2xx', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response);
    const gateway = new AbacatePayGateway(config, fetchFn as unknown as FetchLike);
    await expect(
      gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' }),
    ).rejects.toThrow(/AbacatePay/);
  });

  it('propaga erro quando a resposta não tem `data`', async () => {
    const fetchFn = vi.fn(async () => respostaOk({ success: true }));
    const gateway = new AbacatePayGateway(config, fetchFn as unknown as FetchLike);
    await expect(
      gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(100), descricao: 'x', externalId: 'e' }),
    ).rejects.toThrow(/AbacatePay/);
  });

  it('simularPagamento chama POST /transparents/simulate-payment?id= com o gatewayId', async () => {
    const fetchFn = vi.fn(async () => respostaOk({ data: {} }));
    const gateway = new AbacatePayGateway(config, fetchFn as unknown as FetchLike);
    await gateway.simularPagamento('pix_9');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.abacatepay.com/v2/transparents/simulate-payment?id=pix_9');
    expect(init.method).toBe('POST');
  });

  it('expõe expiraEmSegundos vindo da config (usado pelos use cases pra calcular expiraEm local)', () => {
    const gateway = new AbacatePayGateway(config, vi.fn() as unknown as FetchLike);
    expect(gateway.expiraEmSegundos).toBe(3600);
  });
});
