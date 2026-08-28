/**
 * COMISSÃO SOBRE O LÍQUIDO — a taxa configurada por gateway.
 *
 * Decisão do dono: em todo pagamento online, a comissão do barbeiro incide sobre o
 * valor LÍQUIDO. Para descontar a taxa é preciso conhecê-la, e os dois gateways
 * respondem de forma diferente:
 *
 * - **Mercado Pago** informa `paid_amount` na order, distinto de `amount`. É o
 *   número real da transação. A taxa configurada aqui é só uma **rede** para o caso
 *   de o campo faltar numa resposta.
 * - **AbacatePay** não expõe líquido em lugar nenhum. Para ela, a taxa configurada
 *   é a **única** fonte possível.
 *
 * ## Por que isto é validado no BOOT, e não na conclusão do atendimento
 *
 * O plano original mandava, quando o líquido não fosse conhecido na conclusão,
 * "adiar o lançamento em vez de lançar bruto" — para não gravar um número errado
 * num ledger imutável.
 *
 * Não fazemos isso, e a razão é o que aconteceria depois: **nada** existe no sistema
 * para liberar um lançamento adiado. A comissão do barbeiro simplesmente não
 * apareceria, sem erro, sem tela, sem job — e quem descobriria seria ele, no dia do
 * acerto, achando que o sistema comeu o dinheiro dele. Trocar "número aproximado" por
 * "número nenhum" é pior nos dois eixos: erra mais e erra em silêncio.
 *
 * Então a incerteza é eliminada **antes** de o sistema subir: com um gateway online
 * ativo, a taxa é obrigatória. Um deploy sem ela falha em `config-seguranca.ts`, com
 * mensagem dizendo onde achar o número — e `scripts/deploy.sh` repete a checagem
 * antes de subir container. Se ainda assim o líquido faltar em runtime (resposta
 * estranha do gateway com a env vazia), o handler lança o BRUTO e grita no log: o
 * barbeiro recebe a mais, nunca a menos, e o erro fica visível.
 */

export interface ConfigComissaoLiquida {
  /**
   * Taxa efetiva em pontos-base (1% = 100), por provedor. `null` = não
   * configurada.
   *
   * Pontos-base, e não float de percentual, pela mesma razão que dinheiro é
   * inteiro de centavos: `2.99` não existe em binário, e uma taxa que "quase" bate
   * produz um centavo de diferença por atendimento que ninguém consegue explicar
   * no fim do mês.
   */
  readonly abacatepayBp: number | null;
  readonly mercadopagoBp: number | null;
}

export const CONFIG_COMISSAO_LIQUIDA = Symbol('ConfigComissaoLiquida');

/** Teto de sanidade: 30%. Nenhum gateway brasileiro cobra isso à vista. */
const TAXA_MAXIMA_BP = 3000;

/**
 * Lê e VALIDA uma taxa em pontos-base.
 *
 * Vazio/ausente → `null` (não configurada). Qualquer outra coisa que não seja um
 * inteiro entre 0 e 3000 **lança**: um `"2.99"` colado no lugar de `"299"`, ou um
 * `"29900"` com zero sobrando, viraria comissão errada em todo atendimento. Falhar
 * no boot é a única chance de pegar isso antes de virar lançamento imutável.
 */
export function lerTaxaBp(bruto: string | undefined, nomeDaVar: string): number | null {
  if (bruto === undefined || bruto.trim() === '') return null;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 0 || n > TAXA_MAXIMA_BP) {
    throw new Error(
      `${nomeDaVar}="${bruto}" é inválido. Use um INTEIRO em pontos-base entre 0 e ${TAXA_MAXIMA_BP} ` +
        `(1% = 100; 2,99% = 299). Um valor com vírgula, ou fora dessa faixa, produziria comissão ` +
        `errada em todo atendimento online — e o ledger de comissão é imutável.`,
    );
  }
  return n;
}

export function lerConfigComissaoLiquida(
  env: NodeJS.ProcessEnv = process.env,
): ConfigComissaoLiquida {
  return {
    abacatepayBp: lerTaxaBp(env.ABACATEPAY_TAXA_BASIS_POINTS, 'ABACATEPAY_TAXA_BASIS_POINTS'),
    mercadopagoBp: lerTaxaBp(env.MERCADOPAGO_TAXA_BASIS_POINTS, 'MERCADOPAGO_TAXA_BASIS_POINTS'),
  };
}

/** A taxa configurada para o provedor que criou aquela cobrança. */
export function taxaBpDoProvedor(
  config: ConfigComissaoLiquida,
  provedor: 'ABACATEPAY' | 'MERCADOPAGO' | 'FAKE' | null,
): number | null {
  if (provedor === 'ABACATEPAY') return config.abacatepayBp;
  if (provedor === 'MERCADOPAGO') return config.mercadopagoBp;
  // FAKE não cobra taxa nenhuma (é o gateway de desenvolvimento), e `null` —
  // intenção anterior à coluna `gateway`, ou modo manual por WhatsApp — também
  // não passou por gateway. Zero, não `null`: aqui a taxa é CONHECIDA e é zero.
  return 0;
}
