import { describe, expect, it, vi } from 'vitest';
import { AbacatePayGateway, FetchLike } from './abacatepay.gateway';
import { Dinheiro } from '../../../shared/domain/dinheiro';

const config = { apiKey: 'key-abc', baseUrl: 'https://api.abacatepay.com/v1', expiraEmSegundos: 3600 };

function respostaOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('AbacatePayGateway (fetch mockado)', () => {
  it('cria cobrança PIX e mapeia brCode/brCodeBase64 → copiaECola/qrCode', async () => {
    const fetchFn = vi.fn(async () =>
      respostaOk({ data: { id: 'pix_1', brCode: '00020126-COPIA', brCodeBase64: 'data:image/png;base64,QR', status: 'PENDING' } }),
    ) as unknown as FetchLike;
    const gateway = new AbacatePayGateway(config, fetchFn);

    const cobranca = await gateway.criarCobrancaPix({
      valor: Dinheiro.deCentavos(4000),
      descricao: 'Pacote X',
      externalId: 'ext-42',
    });

    expect(cobranca).toEqual({ gatewayId: 'pix_1', qrCode: 'data:image/png;base64,QR', copiaECola: '00020126-COPIA' });
  });

  it('envia o externalId em metadata, o valor em centavos e o Bearer da API key', async () => {
    const fetchFn = vi.fn(async () => respostaOk({ data: { id: 'p', brCode: 'c', brCodeBase64: 'q', status: 'PENDING' } }));
    const gateway = new AbacatePayGateway(config, fetchFn as unknown as FetchLike);

    await gateway.criarCobrancaPix({ valor: Dinheiro.deCentavos(4000), descricao: 'Pacote X', externalId: 'ext-42' });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.abacatepay.com/v1/pixQrCode/create');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-abc');
    const enviado = JSON.parse(init.body as string);
    expect(enviado.amount).toBe(4000);
    expect(enviado.metadata).toEqual({ externalId: 'ext-42' });
    expect(enviado.expiresIn).toBe(3600);
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

  it('simularPagamento chama o endpoint de simulação com o id', async () => {
    const fetchFn = vi.fn(async () => respostaOk({ data: {} }));
    const gateway = new AbacatePayGateway(config, fetchFn as unknown as FetchLike);
    await gateway.simularPagamento('pix_9');
    const [url] = fetchFn.mock.calls[0] as [string];
    expect(url).toBe('https://api.abacatepay.com/v1/pixQrCode/simulate-payment?id=pix_9');
  });
});
