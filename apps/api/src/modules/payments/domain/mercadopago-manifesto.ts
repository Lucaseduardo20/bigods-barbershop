/**
 * Construção do MANIFESTO que o Mercado Pago assina em cada notificação de
 * webhook, e leitura do header `x-signature`.
 *
 * Puro de propósito: nada de `node:crypto` aqui. O HMAC vive no verificador, na
 * infra (`mercadopago-webhook.verifier.ts`), do mesmo jeito que o do AbacatePay.
 * Aqui fica só a montagem de string — que é justamente a parte que erra.
 *
 * ## O formato, transcrito da documentação
 *
 *     id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Três detalhes que a doc diz e que são fáceis de errar, cada um com consequência
 * de 401 em 100% das notificações:
 *
 * 1. **`data.id` vem do QUERY PARAM da URL**, não do corpo. Com Express a chave
 *    é literal, com ponto: `req.query['data.id']` — o `qs` não interpreta pontos
 *    (`allowDots` é falso por padrão), então `req.query.data.id` é `undefined`.
 * 2. **Parte ausente é REMOVIDA**, não deixada vazia. Sem `x-request-id` o
 *    manifesto é `id:…;ts:…;`, e não `id:…;request-id:;ts:…;`.
 * 3. **Há um `;` no fim**, depois da última parte.
 *
 * ## A divergência de CAIXA, e por que aceitamos as duas
 *
 * A documentação manda minusculizar o `data.id`: *"If `data.id` is returned with
 * uppercase alphanumeric characters, convert it to lowercase before using it in
 * the manifest. For example, `ORD01JQ4S4KY8HWQ6NA5PXB65B3D3` should be used as
 * `ord01jq4s4ky8hwq6na5pxb65b3d3`"*.
 *
 * O SDK oficial Node, da versão 3.2.0 em diante (PR #439), REMOVEU essa
 * minusculização e assina o valor cru. Como todo id de order chega em CAIXA
 * ALTA, as duas leituras dão resultados diferentes em **100%** das notificações —
 * uma das duas está errada, e a documentação não permite decidir qual.
 *
 * Então geramos AS DUAS variantes e aceitamos qualquer uma que bata. Isso **não**
 * afrouxa a autenticação: as duas derivam do MESMO dado recebido, e o atacante
 * continua tendo que forjar um HMAC-SHA256 válido com o secret. O ganho para
 * força bruta é um fator 2 sobre um espaço de 256 bits — irrelevante. O que se
 * elimina é o risco real: escolher a variante errada e ter todo webhook
 * respondendo 401, com nenhum pagamento confirmando. Falha silenciosa, a mesma
 * classe de bug que o DOMAIN.md §3.8 documenta para a AbacatePay.
 *
 * Quando soubermos empiricamente qual variante o Mercado Pago usa (via "Simular
 * notificação" no painel, ou `notifications_history_diagnostics` do MCP Server),
 * dá para simplificar para uma só — ver `followup.md` #8.
 */

export interface PartesDoManifesto {
  /** `data.id` como veio no QUERY PARAM (ex.: `ORD01JQ4S4KY8HWQ6NA5PXB65B3D3`). */
  dataId?: string;
  /** Header `x-request-id`, se presente. */
  requestId?: string;
  /** `ts` extraído do header `x-signature`, em milissegundos. */
  ts: string;
}

/**
 * Monta UM manifesto, com o `dataId` exatamente como recebido (sem mexer na
 * caixa). Quem precisa das duas variantes usa `manifestosCandidatos`.
 */
export function montarManifesto(partes: PartesDoManifesto): string {
  const pedacos: string[] = [];
  // Vazio e ausente são tratados igual: a doc manda REMOVER a parte, e
  // `id:;` seria uma terceira coisa que ninguém documentou.
  if (partes.dataId) pedacos.push(`id:${partes.dataId}`);
  if (partes.requestId) pedacos.push(`request-id:${partes.requestId}`);
  pedacos.push(`ts:${partes.ts}`);
  return `${pedacos.join(';')};`;
}

/**
 * As variantes de manifesto a testar contra o `v1` recebido: `data.id`
 * minusculizado (o que a doc manda) e cru (o que o SDK oficial faz).
 *
 * Devolve UM único candidato quando não há `data.id` ou quando ele já é
 * minúsculo — não faz sentido conferir a mesma string duas vezes.
 */
export function manifestosCandidatos(partes: PartesDoManifesto): readonly string[] {
  if (!partes.dataId) return [montarManifesto(partes)];

  const minusculo = partes.dataId.toLowerCase();
  const variantes = minusculo === partes.dataId ? [partes.dataId] : [minusculo, partes.dataId];
  return variantes.map((dataId) => montarManifesto({ ...partes, dataId }));
}

/**
 * Lê o header `x-signature`, no formato `ts=1742505638683,v1=ced36ab6…`.
 *
 * Chaves desconhecidas são ignoradas em vez de causarem erro: o Mercado Pago
 * pode acrescentar um `v2` no futuro, e isso não deve derrubar a validação do
 * `v1` que já funciona.
 *
 * Devolve os campos ausentes como `undefined` — decidir o que fazer com header
 * malformado é do verificador (que falha fechado), não desta função.
 */
export function extrairAssinatura(header: string | undefined): { ts?: string; v1?: string } {
  if (!header) return {};

  let ts: string | undefined;
  let v1: string | undefined;
  for (const parte of header.split(',')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    const chave = parte.slice(0, igual).trim();
    // slice em vez de split('='): um valor que contenha '=' (base64, por
    // exemplo) não pode ser truncado no meio.
    const valor = parte.slice(igual + 1).trim();
    if (chave === 'ts') ts = valor;
    if (chave === 'v1') v1 = valor;
  }
  return { ts, v1 };
}

/**
 * O `ts` do Mercado Pago é um epoch em MILISSEGUNDOS (13 dígitos no exemplo da
 * doc: `1742505638683`).
 *
 * Isto existe como função nomeada porque o SDK oficial erra exatamente aqui: da
 * versão 3.3.0 em diante ele faz `Number(ts) * 1000`, assumindo segundos, o que
 * torna a tolerância de tempo inutilizável (todo `ts` legítimo parece estar 55
 * mil anos no futuro).
 */
export function tsEhNumerico(ts: string | undefined): boolean {
  return typeof ts === 'string' && /^\d+$/.test(ts);
}
