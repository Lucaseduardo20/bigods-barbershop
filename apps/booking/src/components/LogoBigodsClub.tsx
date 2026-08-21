/**
 * Marca do Bigod's Club (2026-08-20) — substitui o 👑 + texto que representava
 * o clube antes de a logo existir.
 *
 * ## Qual variação, e por quê
 *
 * O pacote de marca traz sete variações. A escolha aqui não é estética, é de
 * legibilidade, e foi feita olhando as telas:
 *
 * - **`marca` (coroa + bigode), em OURO ou INK** — é o que usamos. O LEIA-ME do
 *   pacote é explícito: ouro para fundos escuros, ink para claros. Silhueta
 *   simples, que continua legível a 22-28 px de altura.
 * - **`medalha`** foi a primeira tentativa e está ERRADA para o card do clube:
 *   o disco dela é ink, o mesmo tom do fundo escuro do card, então ela se
 *   dissolve; e o aro com o texto em arco vira um borrão abaixo de ~56 px.
 * - **`lockup` / `wordmark`** trazem o nome desenhado, mas o wordmark é ink
 *   (#342414): servem só em fundo claro, e com altura suficiente para o texto
 *   ser lido — ver a conta do cliente, onde o lockup inteiro cabe.
 *
 * ## SVG aqui, PNG no lockup
 *
 * As duas `marca` são vetor puro + o bigode original embutido: **sem texto**,
 * logo sem dependência de fonte, logo seguras como `<img src>` e escaláveis.
 *
 * Já os SVGs COM texto (wordmark, medalha, lockups) desenham o nome com
 * `<text font-family="Rye">`. Um SVG carregado via `<img>` renderiza em contexto
 * isolado e NÃO acessa as fontes do documento — mesmo com o app carregando Rye
 * do Google Fonts, o nome cairia em Georgia. Para esses, PNG (texto já
 * rasterizado com a fonte certa).
 */

/** Coroa + bigode. `tom` acompanha o FUNDO: ouro em fundo escuro, ink em claro. */
export function MarcaBigodsClub({
  tom,
  altura = 24,
}: {
  tom: 'ouro' | 'ink';
  altura?: number;
}) {
  return (
    <img
      src={`/brand/bigods-club-marca-${tom}.svg`}
      alt="Bigod's Club"
      style={{ display: 'block', height: altura, width: 'auto', flexShrink: 0 }}
    />
  );
}
