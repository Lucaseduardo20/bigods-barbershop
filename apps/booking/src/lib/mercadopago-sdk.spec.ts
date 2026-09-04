import { describe, expect, it, vi } from 'vitest';
import {
  bandeiraDoBin,
  carregarSdkMercadoPago,
  coletarDeviceId,
  injetarScript,
  SdkIndisponivelError,
  URL_SDK,
  URL_SECURITY,
  type SdkMercadoPago,
} from './mercadopago-sdk';

/**
 * DOM falso, mínimo e sob controle: o teste precisa decidir QUANDO o script
 * "carrega" ou "falha", e nenhum ambiente de teste real deixa `<script src>`
 * disparar `load` sem rede.
 *
 * Os scripts criados ficam numa lista para o teste poder disparar os eventos.
 */
function fakeDom() {
  const criados: {
    src: string;
    dataset: Record<string, string>;
    atributos: Record<string, string>;
    handlers: Record<string, (() => void)[]>;
  }[] = [];

  const documento = {
    querySelector: (seletor: string) => {
      const m = /^script\[src="(.+)"\]$/.exec(seletor);
      if (!m) return null;
      return criados.find((s) => s.src === m[1]) ?? null;
    },
    createElement: () => {
      const el = {
        src: '',
        async: false,
        dataset: {} as Record<string, string>,
        atributos: {} as Record<string, string>,
        handlers: {} as Record<string, (() => void)[]>,
        setAttribute(k: string, v: string) {
          this.atributos[k] = v;
        },
        addEventListener(evento: string, handler: () => void) {
          (this.handlers[evento] ??= []).push(handler);
        },
      };
      return el;
    },
    head: {
      appendChild: (el: unknown) => {
        criados.push(el as (typeof criados)[number]);
      },
    },
  } as unknown as Document;

  const disparar = (src: string, evento: 'load' | 'error') => {
    const el = criados.find((s) => s.src === src);
    if (!el) throw new Error(`nenhum script com src=${src}`);
    for (const h of el.handlers[evento] ?? []) h();
  };

  return { documento, criados, disparar };
}

describe('injetarScript', () => {
  it('injeta o script e resolve no `load`', async () => {
    const dom = fakeDom();
    const janela = {} as never;
    const p = injetarScript(URL_SDK, { documento: dom.documento, janela });
    expect(dom.criados).toHaveLength(1);
    expect(dom.criados[0]!.src).toBe(URL_SDK);
    dom.disparar(URL_SDK, 'load');
    await expect(p).resolves.toBeUndefined();
  });

  it('passa atributos extras (o antifraude precisa de `view` e `output`)', async () => {
    const dom = fakeDom();
    const p = injetarScript(
      URL_SECURITY,
      { documento: dom.documento, janela: {} as never },
      { view: 'checkout', output: 'MP_DEVICE_SESSION_ID' },
    );
    expect(dom.criados[0]!.atributos).toEqual({
      view: 'checkout',
      output: 'MP_DEVICE_SESSION_ID',
    });
    dom.disparar(URL_SECURITY, 'load');
    await p;
  });

  it('rejeita com SdkIndisponivelError no `error` (bloqueio de CSP ou rede)', async () => {
    const dom = fakeDom();
    const p = injetarScript(URL_SDK, { documento: dom.documento, janela: {} as never });
    dom.disparar(URL_SDK, 'error');
    await expect(p).rejects.toBeInstanceOf(SdkIndisponivelError);
  });

  it('★ rejeita por TIMEOUT quando nada dispara — CSP pode não emitir `error`', async () => {
    // Sem este caminho, um bloqueio silencioso deixaria a promessa pendente para
    // sempre e o cliente olhando um spinner eterno, sem nem a saída do PIX.
    vi.useFakeTimers();
    try {
      const dom = fakeDom();
      const p = injetarScript(URL_SDK, {
        documento: dom.documento,
        janela: {} as never,
        timeoutMs: 5000,
      });
      const capturada = p.catch((e: unknown) => e);
      vi.advanceTimersByTime(5001);
      expect(await capturada).toBeInstanceOf(SdkIndisponivelError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('★ dois cliques rápidos NÃO injetam dois scripts', async () => {
    // Duas tags do MercadoPago.js redefiniriam `window.MercadoPago` no meio do uso
    // da primeira, e os Secure Fields já montados apontariam para um SDK morto.
    const dom = fakeDom();
    const deps = { documento: dom.documento, janela: {} as never };
    const p1 = injetarScript(URL_SDK, deps);
    const p2 = injetarScript(URL_SDK, deps);
    expect(dom.criados).toHaveLength(1);
    dom.disparar(URL_SDK, 'load');
    await Promise.all([p1, p2]);
  });

  it('script já carregado resolve na hora, sem injetar de novo', async () => {
    const dom = fakeDom();
    const deps = { documento: dom.documento, janela: {} as never };
    const p = injetarScript(URL_SDK, deps);
    dom.disparar(URL_SDK, 'load');
    await p;
    await expect(injetarScript(URL_SDK, deps)).resolves.toBeUndefined();
    expect(dom.criados).toHaveLength(1);
  });

  it('depois de um erro, uma nova tentativa reusa a tag em vez de acumular tags mortas', async () => {
    const dom = fakeDom();
    const deps = { documento: dom.documento, janela: {} as never };
    const p1 = injetarScript(URL_SDK, deps);
    dom.disparar(URL_SDK, 'error');
    await expect(p1).rejects.toBeInstanceOf(SdkIndisponivelError);

    const p2 = injetarScript(URL_SDK, deps);
    expect(dom.criados).toHaveLength(1);
    dom.disparar(URL_SDK, 'load');
    await expect(p2).resolves.toBeUndefined();
  });
});

describe('carregarSdkMercadoPago', () => {
  it('constrói o SDK com locale pt-BR', async () => {
    const dom = fakeDom();
    const Construtor = vi.fn(function (this: unknown) {
      return { fields: {}, getPaymentMethods: vi.fn() } as never;
    });
    const janela = { MercadoPago: Construtor } as never;
    const p = carregarSdkMercadoPago('APP_USR-chave', { documento: dom.documento, janela });
    dom.disparar(URL_SDK, 'load');
    await p;
    expect(Construtor).toHaveBeenCalledWith('APP_USR-chave', { locale: 'pt-BR' });
  });

  it('★ recusa chave vazia ANTES de injetar script nenhum', async () => {
    // Chave vazia é o que chega quando o deploy não configurou
    // MERCADOPAGO_PUBLIC_KEY. Falhar aqui leva o cliente à tela com o PIX ao
    // lado; injetar o script e falhar depois daria erro genérico do gateway.
    const dom = fakeDom();
    await expect(
      carregarSdkMercadoPago('', { documento: dom.documento, janela: {} as never }),
    ).rejects.toBeInstanceOf(SdkIndisponivelError);
    expect(dom.criados).toHaveLength(0);
  });

  it('★ script carrega mas não expõe o global → erro, nunca objeto vazio', async () => {
    // Proxy corporativo devolvendo HTML, versão trocada, extensão que neutraliza
    // o script. Resolver com algo "quase certo" faria o erro aparecer só na
    // tokenização, como TypeError sem relação com a causa.
    const dom = fakeDom();
    const p = carregarSdkMercadoPago('APP_USR-x', {
      documento: dom.documento,
      janela: {} as never,
    });
    const capturada = p.catch((e: unknown) => e);
    dom.disparar(URL_SDK, 'load');
    expect(await capturada).toBeInstanceOf(SdkIndisponivelError);
  });
});

describe('coletarDeviceId', () => {
  it('devolve o global quando o antifraude carrega', async () => {
    const dom = fakeDom();
    const janela = { MP_DEVICE_SESSION_ID: 'sess-123' } as never;
    const p = coletarDeviceId({ documento: dom.documento, janela });
    dom.disparar(URL_SECURITY, 'load');
    expect(await p).toBe('sess-123');
  });

  it('★ falha do antifraude devolve undefined, NUNCA lança', async () => {
    // O script do antifraude é o mais provável de ser bloqueado por extensão de
    // privacidade. Trocar "cliente não consegue pagar" por "aprova um pouco
    // menos" seria uma troca ruim — então esta função não pode derrubar o fluxo.
    const dom = fakeDom();
    const p = coletarDeviceId({ documento: dom.documento, janela: {} as never });
    dom.disparar(URL_SECURITY, 'error');
    expect(await p).toBeUndefined();
  });
});

describe('bandeiraDoBin', () => {
  const sdkCom = (results: { id: string }[]): SdkMercadoPago =>
    ({
      getPaymentMethods: vi.fn().mockResolvedValue({ results }),
    }) as unknown as SdkMercadoPago;

  it('devolve o id do primeiro método', async () => {
    expect(await bandeiraDoBin(sdkCom([{ id: 'master' }]), '503175')).toBe('master');
  });

  it('BIN curto não consulta nada', async () => {
    const sdk = sdkCom([{ id: 'visa' }]);
    expect(await bandeiraDoBin(sdk, '4111')).toBeNull();
    expect(sdk.getPaymentMethods).not.toHaveBeenCalled();
  });

  it('★ BIN desconhecido devolve null — nunca adivinha uma bandeira', async () => {
    // Enviar `paymentMethodId` errado faz o Mercado Pago recusar com erro de
    // validação, que o cliente leria como "cartão recusado".
    expect(await bandeiraDoBin(sdkCom([]), '999999')).toBeNull();
  });

  it('erro de rede na consulta devolve null em vez de propagar', async () => {
    const sdk = {
      getPaymentMethods: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as SdkMercadoPago;
    expect(await bandeiraDoBin(sdk, '503175')).toBeNull();
  });
});
