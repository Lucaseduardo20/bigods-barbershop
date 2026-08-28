import { bandeiraPeloBin } from './cartao';

/**
 * Carregamento do MercadoPago.js V2 **sob demanda**, com falha explícita.
 *
 * ## Por que não no `index.html`
 *
 * O SDK só é necessário para quem escolhe cartão. Colocá-lo no `index.html`
 * custaria uma requisição de terceiros a `sdk.mercadopago.com` em TODA visita ao
 * funil — inclusive na landing e em quem paga por PIX — e daria ao Mercado Pago um
 * ponto de observação sobre visitantes que nunca chegaram ao checkout.
 *
 * ## Por que a falha precisa ser tratada, e não só logada
 *
 * A CSP do CloudFront é ação do dono (`followup.md` #7) e pode não estar aplicada
 * quando o primeiro cliente clicar em "cartão". Bloqueado pela CSP, o `<script>`
 * dispara `onerror` — mas um bloqueio de CSP também pode simplesmente não
 * disparar nada em alguns navegadores, e aí a promessa nunca resolveria e o
 * cliente ficaria num spinner eterno. Daí o timeout explícito.
 *
 * Falhar aqui NÃO é um erro fatal do funil: quem chama volta o cliente para o
 * PIX, que não depende de nenhum recurso de terceiro.
 */

/** Bandeira que o SDK deduz do BIN. É o que vai no corpo do POST de cartão. */
export interface MetodoDoCartao {
  paymentMethodId: string;
}

/** Um campo seguro montado num iframe do Mercado Pago. */
export interface CampoSeguro {
  mount(elementId: string): CampoSeguro;
  unmount(): void;
  on(evento: string, handler: (dados: { bin?: string }) => void): void;
}

/** A fatia do MercadoPago.js que este projeto usa. Declarada à mão, de propósito. */
export interface SdkMercadoPago {
  fields: {
    create(tipo: 'cardNumber' | 'expirationDate' | 'securityCode', opcoes?: { placeholder?: string }): CampoSeguro;
    createCardToken(dados: {
      cardholderName: string;
      identificationType: string;
      identificationNumber: string;
    }): Promise<{ id: string }>;
  };
  getPaymentMethods(params: { bin: string }): Promise<{ results: { id: string }[] }>;
}

export const URL_SDK = 'https://sdk.mercadopago.com/js/v2';
/**
 * Script do antifraude, que popula `window.MP_DEVICE_SESSION_ID`. Separado do
 * SDK principal e OPCIONAL: sem ele a cobrança funciona, só perde sinal de
 * antifraude (e portanto aprova menos). Nunca bloqueia o checkout.
 */
export const URL_SECURITY = 'https://www.mercadopago.com/v2/security.js';

const TIMEOUT_MS = 10_000;

interface Deps {
  documento: Document;
  janela: Window & { MercadoPago?: new (chave: string, opcoes?: { locale?: string }) => SdkMercadoPago; MP_DEVICE_SESSION_ID?: string };
  timeoutMs?: number;
}

export class SdkIndisponivelError extends Error {}

/**
 * Injeta um `<script>` uma única vez e resolve quando ele carrega.
 *
 * Reentrante de propósito: dois cliques rápidos em "cartão" não podem injetar
 * dois scripts (o segundo redefiniria `window.MercadoPago` no meio do uso do
 * primeiro). A chave da deduplicação é o `src`, lido do próprio DOM — sobrevive a
 * um remount do React, que um `Set` em memória de módulo também sobreviveria, mas
 * não a um hot-reload.
 */
export function injetarScript(
  src: string,
  deps: Deps,
  atributos: Record<string, string> = {},
): Promise<void> {
  const { documento } = deps;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const jaExiste = documento.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (jaExiste?.dataset.carregado === 'sim') return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const alvo =
      jaExiste ??
      (() => {
        const el = documento.createElement('script');
        el.src = src;
        el.async = true;
        for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
        documento.head.appendChild(el);
        return el;
      })();

    // Timeout: um bloqueio de CSP pode não disparar `onerror` em todo navegador,
    // e sem isto o cliente ficaria olhando um spinner para sempre.
    const relogio = setTimeout(() => {
      reject(new SdkIndisponivelError(`Timeout ao carregar ${src}`));
    }, timeoutMs);

    alvo.addEventListener('load', () => {
      clearTimeout(relogio);
      alvo.dataset.carregado = 'sim';
      resolve();
    });
    alvo.addEventListener('error', () => {
      clearTimeout(relogio);
      // O elemento fica no DOM sem `data-carregado`: uma nova tentativa reusa e
      // reanexa os listeners, em vez de acumular tags mortas.
      reject(new SdkIndisponivelError(`Falha ao carregar ${src} (CSP ou rede)`));
    });
  });
}

/**
 * Carrega o SDK e devolve a instância pronta.
 *
 * Lança `SdkIndisponivelError` — nunca resolve com `null`. Um `null` silencioso
 * faria o chamador seguir com um objeto vazio e falhar mais tarde, na
 * tokenização, com um `TypeError` sem relação com a causa.
 */
export async function carregarSdkMercadoPago(
  publicKey: string,
  deps: Deps,
): Promise<SdkMercadoPago> {
  if (!publicKey) {
    throw new SdkIndisponivelError('Chave pública do Mercado Pago ausente');
  }
  await injetarScript(URL_SDK, deps);
  const Construtor = deps.janela.MercadoPago;
  if (typeof Construtor !== 'function') {
    // Script carregou mas não expôs o global: proxy corporativo devolvendo HTML,
    // versão trocada, ou bloqueio de extensão. Mesma saída do erro de rede.
    throw new SdkIndisponivelError('MercadoPago.js carregou sem expor window.MercadoPago');
  }
  return new Construtor(publicKey, { locale: 'pt-BR' });
}

/**
 * Device ID do antifraude. **Best-effort por contrato**: resolve com `undefined`
 * se o script não carregar ou não popular o global no tempo esperado.
 *
 * ★ Não pode ser `await`-ado como pré-condição do pagamento. O sinal melhora a
 * taxa de aprovação, mas trocar "cliente não consegue pagar" por "aprova um pouco
 * menos" é uma troca ruim — e o script do antifraude é justamente o mais provável
 * de ser bloqueado por extensão de privacidade.
 */
export async function coletarDeviceId(deps: Deps): Promise<string | undefined> {
  try {
    await injetarScript(URL_SECURITY, deps, { view: 'checkout', output: 'MP_DEVICE_SESSION_ID' });
    return deps.janela.MP_DEVICE_SESSION_ID;
  } catch {
    return undefined;
  }
}

/**
 * Bandeira a partir do BIN (os 6–8 primeiros dígitos), consultada no SDK.
 *
 * O `paymentMethodId` (`visa`, `master`, `elo`…) é obrigatório no POST, e o BIN é
 * a única coisa que o iframe do Secure Field expõe ao nosso código — por design:
 * é o prefixo que identifica o emissor, não o cartão.
 *
 * ## O SDK é a fonte primária; a tabela local é a REDE
 *
 * `getPaymentMethods` é uma chamada de rede a `api.mercadopago.com`, sujeita a CSP
 * não aplicada, extensão de privacidade, latência e mudança de formato de
 * resposta. A primeira versão desta função capturava tudo e devolvia `null` — e
 * `null` fazia o checkout inteiro travar em "não reconhecemos a bandeira do
 * cartão", **culpando o cliente por um problema nosso**, sem nada no console.
 *
 * Agora: o SDK responde → usa a resposta dele (autoritativa, conhece faixas novas
 * e bandeiras regionais). O SDK falha ou volta vazio → cai em `bandeiraPeloBin`,
 * que é determinística e cobre o que praticamente todo cartão brasileiro é.
 *
 * ★ E o erro é LOGADO. Silêncio aqui custou uma sessão de depuração.
 *
 * Devolve `null` só quando o BIN é curto demais ou realmente não bate com faixa
 * nenhuma — aí é o cliente que digitou algo errado, e a mensagem é honesta.
 */
export async function bandeiraDoBin(sdk: SdkMercadoPago, bin: string): Promise<string | null> {
  if (bin.length < 6) return null;
  try {
    const resposta = await sdk.getPaymentMethods({ bin });
    const doSdk = resposta?.results?.[0]?.id;
    if (doSdk) return doSdk;
    console.warn(
      `[bigods] getPaymentMethods não reconheceu o BIN ${bin} (resposta:`,
      resposta,
      '). Usando a tabela local.',
    );
  } catch (e) {
    console.warn(
      `[bigods] getPaymentMethods falhou para o BIN ${bin} — usando a tabela local.`,
      e,
    );
  }
  return bandeiraPeloBin(bin);
}
