import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpWhatsAppOtpClient, WhatsAppEnvioIndisponivelError } from './whatsapp-otp.client';

describe('HttpWhatsAppOtpClient (fetch mockado)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST em {baseUrl}/enviar com o token interno e o corpo certo', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpWhatsAppOtpClient('http://otp.local:3100', 'tok-123');
    await client.enviar('+5511999998888', 'seu código é 123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://otp.local:3100/enviar');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Internal-Token']).toBe('tok-123');
    expect(JSON.parse(init.body as string)).toEqual({
      telefone: '+5511999998888',
      mensagem: 'seu código é 123456',
    });
  });

  it('resposta não-OK (serviço fora/erro) vira WhatsAppEnvioIndisponivelError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const client = new HttpWhatsAppOtpClient('http://otp.local:3100', 'tok-123');
    await expect(client.enviar('+5511999998888', 'x')).rejects.toThrow(WhatsAppEnvioIndisponivelError);
  });

  it('erro de rede (conexão recusada) vira WhatsAppEnvioIndisponivelError, nunca a exceção crua', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const client = new HttpWhatsAppOtpClient('http://otp.local:3100', 'tok-123');
    await expect(client.enviar('+5511999998888', 'x')).rejects.toThrow(WhatsAppEnvioIndisponivelError);
  });

  it('timeout (serviço pendurado) aborta e vira WhatsAppEnvioIndisponivelError, nunca trava', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }),
    );
    const client = new HttpWhatsAppOtpClient('http://otp.local:3100', 'tok-123', 20);
    await expect(client.enviar('+5511999998888', 'x')).rejects.toThrow(WhatsAppEnvioIndisponivelError);
  });
});
