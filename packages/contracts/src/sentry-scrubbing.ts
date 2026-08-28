/**
 * LIMPEZA DE DADO SENSÍVEL ANTES DE SAIR DAQUI (2026-08-21).
 *
 * Relatório de erro é dado que sai da nossa infraestrutura e vai parar num
 * serviço de terceiro, visível para quem tiver acesso ao painel. Um stack trace
 * com o telefone do cliente, a senha digitada ou o código do OTP é vazamento —
 * não importa que a intenção fosse depurar.
 *
 * Este arquivo é PURO de propósito: nada de SDK, nada de Nest. É a regra, e ela
 * é testável isoladamente. Quem pluga é `sentry.ts`.
 *
 * ## O desenho: quatro camadas, porque uma só sempre deixa passar
 *
 * 1. **Rotas mudas** — em `/auth/login`, `/conta/login/*`, webhooks e
 *    credenciais, o corpo da requisição NÃO vai, ponto. Não interessa filtrar
 *    campo a campo num corpo cujo conteúdo inteiro é sensível.
 * 2. **Chaves proibidas** — `senha`, `codigo`, `token`, `authorization` e
 *    parentes viram `[removido]` em QUALQUER profundidade, em qualquer lugar do
 *    evento.
 * 3. **Query string** — `?token=…&clienteNome=…` em QUALQUER string do evento
 *    perde o valor e mantém a chave e a rota.
 * 4. **Telefone em texto livre** — o que escapa das três primeiras: mensagem de
 *    erro, breadcrumb, corpo de log. Um número brasileiro em qualquer string
 *    vira `[telefone]`.
 *
 * A última camada existe porque as anteriores dependem de eu ter previsto o
 * lugar. A varredura por texto não depende.
 *
 * ## O que NÃO é apagado, de propósito
 *
 * Nome de serviço, de pacote e de barbeiro. São o assunto do erro, não o dono
 * dele — sem eles sobra um relatório que diz que algo falhou e nada mais.
 */

/**
 * Prefixos de rota cujo CORPO nunca é enviado. Comparados contra o caminho da
 * URL, sem query string.
 */
export const ROTAS_COM_CORPO_SENSIVEL: readonly string[] = [
  '/auth/login',
  '/conta/login',
  '/conta/cadastro',
  '/webhooks',
  '/pagamentos',
  '/public/pagamentos',
  // PUT /barbeiros/:id/credenciais leva senha nova em texto claro.
  '/barbeiros',
];

/**
 * Nomes de campo que nunca saem, em qualquer profundidade. Comparação
 * case-insensitive e por CONTÉM — `senhaHash`, `novaSenha` e `password_confirm`
 * caem todos na mesma rede.
 *
 * ## Sobre o grupo de pagamento (2026-08-26, Mercado Pago)
 *
 * Cartão e assinatura de webhook entraram aqui, mas o "por CONTÉM" obriga
 * escolher os termos com cuidado — chave curta demais apaga diagnóstico legítimo:
 *
 * - **`pan` NÃO entra.** Está dentro de `expandido`, `expandirTudo` e afins. O
 *   número do cartão é coberto por `cardnumber`/`card_number`/`numerocartao`,
 *   que são os nomes reais usados pelo SDK do Mercado Pago e por nós.
 * - **`expiration` NÃO entra**, `cardexpiration` entra. O Mercado Pago usa
 *   `expiration_time` (duração do PIX) e `date_of_expiration` — ambos são
 *   diagnóstico, não segredo. Só a validade do CARTÃO é sensível, e ela vem como
 *   `cardExpirationMonth`/`cardExpirationYear`.
 * - **`public_key` NÃO entra**: é pública por definição, e apagá-la cegaria a
 *   depuração do SDK no frontend.
 * - **`x-request-id` NÃO entra**: é o identificador que o suporte do Mercado Pago
 *   pede para investigar uma notificação. Apagá-lo custa a investigação.
 * - `session` e `device` são termos ingleses e nosso código é português
 *   (`sessao`), então miram exatamente `X-meli-session-id` e `MP_DEVICE_SESSION_ID`
 *   sem colidir com o que é nosso.
 *
 * O copia-e-cola do PIX (`qr_code`, `brCode`) é instrumento de pagamento ao
 * portador: quem o tem paga a cobrança de outro. Por isso sai daqui também.
 */
export const CHAVES_SENSIVEIS: readonly string[] = [
  'senha',
  'password',
  'hash',
  'codigo',
  'otp',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'dsn',
  'telefone',
  'phone',
  'celular',
  'email',
  'cpf',
  // ── Pagamento: assinatura, idempotência, cartão e instrumento de cobrança ──
  'signature',
  'idempotency',
  'cvv',
  'securitycode',
  'security_code',
  'cardnumber',
  'card_number',
  'numerocartao',
  'numero_cartao',
  'cardholder',
  'titular',
  'cardexpiration',
  'validade',
  'qrcode',
  'qr_code',
  'copiaecola',
  'brcode',
  'device',
  'session',
];

export const REMOVIDO = '[removido]';
export const TELEFONE_MASCARADO = '[telefone]';

/**
 * Telefone brasileiro em texto livre. Casa DDI opcional, DDD, e 8-9 dígitos,
 * com ou sem separadores — que é como o número aparece em mensagem de erro, em
 * query string e em log.
 *
 * Mascara INTEIRO, não só o começo. Guardar os 4 últimos ajudaria a depurar,
 * mas num relatório de erro os 4 últimos + o resto do contexto já identificam
 * uma pessoa, e a regra é "telefone completo do cliente não vai".
 */
/**
 * As duas âncoras `(?<!\d)` e `(?!\d)` não são detalhe: sem elas a regex casa um
 * PEDAÇO de qualquer número longo — o id `20260821020000` de uma migration
 * virava `[telefone]0000`, apagando informação de diagnóstico que não era PII.
 *
 * E o `9` do celular pode vir separado (`(11) 9 8888-7777`), então ele carrega
 * seu próprio separador opcional.
 */
const TELEFONE_BR =
  /(?<!\d)(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\d)/g;

export function mascararTelefones(texto: string): string {
  return texto.replace(TELEFONE_BR, (achado) => {
    // Confere pela contagem de dígitos pra não mascarar qualquer número longo
    // (id de migration, timestamp). Telefone BR tem 10 a 13 dígitos com DDI.
    const digitos = achado.replace(/\D/g, '').length;
    return digitos >= 10 && digitos <= 13 ? TELEFONE_MASCARADO : achado;
  });
}

function ehChaveSensivel(chave: string): boolean {
  const k = chave.toLowerCase();
  return CHAVES_SENSIVEIS.some((proibida) => k.includes(proibida));
}

/**
 * Contextos em que um campo `nome` é o nome de uma PESSOA, e não de um item de
 * catálogo.
 *
 * Nome completo é PII e não pode sair — mas apagar TODO campo chamado `nome`
 * cegaria o relatório: `servico.nome`, `pacote.nome` e `barbeiro.nome` são o que
 * diz QUAL erro aconteceu, e nenhum deles é dado de cliente. Então a decisão
 * olha o caminho: `cliente.nome` sai, `servico.nome` fica.
 */
const CONTEXTOS_DE_PESSOA: readonly string[] = ['cliente', 'usuario', 'user', 'conta'];

/**
 * Nomes de campo que já se identificam sozinhos como nome de pessoa,
 * independentemente de onde estejam (`clienteNome` numa query string não tem
 * objeto pai que dê contexto).
 */
function ehChaveDeNomeDePessoa(chave: string, caminhoPai = ''): boolean {
  const k = chave.toLowerCase();
  if (!k.includes('nome')) return false;
  if (k.includes('completo')) return true;
  if (CONTEXTOS_DE_PESSOA.some((ctx) => k.includes(ctx))) return true;
  return CONTEXTOS_DE_PESSOA.some((ctx) => caminhoPai.includes(ctx));
}

/**
 * Apaga o VALOR dos parâmetros sensíveis de uma query string, preservando a
 * chave e o resto da URL — sem a rota, o evento perde o diagnóstico junto com o
 * dado.
 *
 * Isto não é hipotético: o handoff de sessão do funil para a conta manda
 * `?token=…&clienteNome=…&clienteTelefone=…` na URL (`session.ts`,
 * `PARAMS_SESSAO`). Sem esta limpeza, o Sentry do app `account` registraria a
 * URL da página em TODO evento — erro e breadcrumb de navegação — e o token de
 * sessão de um cliente real estaria no painel, utilizável.
 */
export function limparUrl(texto: string): string {
  const i = texto.indexOf('?');
  if (i < 0) return texto;
  const base = texto.slice(0, i);
  const query = texto.slice(i + 1);
  const limpa = query
    .split('&')
    .map((par) => {
      const eq = par.indexOf('=');
      if (eq < 0) return par;
      const chave = par.slice(0, eq);
      const decodificada = (() => {
        try {
          return decodeURIComponent(chave);
        } catch {
          return chave;
        }
      })();
      const sensivel = ehChaveSensivel(decodificada) || ehChaveDeNomeDePessoa(decodificada);
      return sensivel ? `${chave}=${REMOVIDO}` : par;
    })
    .join('&');
  return `${base}?${limpa}`;
}

/**
 * Percorre qualquer estrutura removendo chave sensível e mascarando telefone em
 * texto. Não muta a entrada: devolve uma cópia limpa.
 *
 * `vistos` é um WeakMap de original → cópia limpa, e NÃO um simples conjunto de
 * "já passei por aqui". A diferença importa: um evento do SDK referencia o mesmo
 * objeto de vários lugares (o mesmo `cliente` no contexto e no breadcrumb), e
 * com um conjunto a segunda ocorrência devolveria o objeto ORIGINAL — limpo no
 * primeiro lugar, sujo no segundo. O mapa faz as duas apontarem para a cópia
 * limpa, e de quebra resolve o ciclo (a cópia é registrada ANTES de recursar).
 *
 * A profundidade é limitada — evento gigante não vira travamento no `beforeSend`.
 */
export function limparProfundo(
  valor: unknown,
  vistos = new WeakMap<object, unknown>(),
  nivel = 0,
  caminhoPai = '',
): unknown {
  if (nivel > 12) return valor;
  if (typeof valor === 'string') return mascararTelefones(limparUrl(valor));
  if (valor === null || typeof valor !== 'object') return valor;

  const ja = vistos.get(valor as object);
  if (ja !== undefined) return ja;

  if (Array.isArray(valor)) {
    const saida: unknown[] = [];
    vistos.set(valor as object, saida);
    for (const v of valor) saida.push(limparProfundo(v, vistos, nivel + 1, caminhoPai));
    return saida;
  }

  const saida: Record<string, unknown> = {};
  vistos.set(valor as object, saida);
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    const sensivel = ehChaveSensivel(chave) || ehChaveDeNomeDePessoa(chave, caminhoPai);
    saida[chave] = sensivel
      ? REMOVIDO
      : limparProfundo(v, vistos, nivel + 1, `${caminhoPai}.${chave.toLowerCase()}`);
  }
  return saida;
}

/** O caminho da URL, sem query string nem host. */
export function caminhoDe(url: string | undefined): string {
  if (!url) return '';
  const semQuery = url.split('?')[0] ?? '';
  const semHost = semQuery.replace(/^https?:\/\/[^/]+/i, '');
  return semHost;
}

export function corpoEhSensivel(url: string | undefined): boolean {
  const caminho = caminhoDe(url);
  return ROTAS_COM_CORPO_SENSIVEL.some((rota) => caminho.startsWith(rota));
}

/**
 * Forma mínima de um evento do Sentry — só o que este módulo toca.
 *
 * Deliberadamente estrutural, e não o tipo do SDK: assim a REGRA (este arquivo,
 * e o teste dela) não depende de versão de biblioteca. `limparEvento` aceita
 * evento de erro, transação e breadcrumb, que no SDK são tipos diferentes com a
 * mesma anatomia no que nos interessa.
 */
export interface EventoParcial {
  request?: {
    url?: string;
    data?: unknown;
    headers?: Record<string, unknown>;
    cookies?: unknown;
    query_string?: unknown;
  };
  [k: string]: unknown;
}

/**
 * `beforeSend` do SDK. Devolve o evento limpo — nunca `null`, porque perder o
 * erro é pior que enviá-lo sem detalhe.
 */
export function limparEvento<T>(evento: T): T {
  const parcial = evento as EventoParcial | null | undefined;
  if (parcial?.request) {
    if (corpoEhSensivel(parcial.request.url)) {
      // O corpo inteiro é sensível: não há o que salvar dele.
      parcial.request.data = REMOVIDO;
    }
    // Cookie nunca ajuda a depurar e sempre carrega sessão.
    delete parcial.request.cookies;
  }
  if (parcial?.user && typeof parcial.user === 'object') {
    // Do usuário fica SÓ o id interno — que é uuid nosso, não identifica
    // ninguém fora do banco. `email`, `username` e `ip_address` são o que o SDK
    // preenche sozinho ou o que um `setUser` distraído mandaria; nenhum sai.
    const { id } = parcial.user as { id?: unknown };
    parcial.user = id === undefined ? {} : { id };
  }
  return limparProfundo(evento) as T;
}
