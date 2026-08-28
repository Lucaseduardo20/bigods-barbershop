import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * Duração no formato ISO 8601, que é como a Orders API do Mercado Pago recebe o
 * prazo de expiração de um PIX (`transactions.payments[].expiration_time`).
 *
 * A documentação mostra o exemplo `"P3Y6M4DT12H30M5S"`. Nós emitimos apenas a
 * parte de TEMPO (`PT…H…M…S`) de propósito: um prazo de pagamento se mede em
 * horas e minutos, e "P1D" versus "PT24H" abre uma discussão sobre horário de
 * verão que não precisamos ter — 24 horas são 24 horas.
 *
 * Isto NÃO é o mesmo conceito que o `expiraEm` da `IntencaoDePagamento`. Aquele
 * é um INSTANTE local nosso, usado para expirar por timeout; este é uma DURAÇÃO
 * pedida ao gateway. Os dois são calculados da mesma janela, uma única vez, para
 * não divergirem — ver DOMAIN.md §3.8.
 */

/**
 * Piso do Mercado Pago para expiração de PIX: **30 minutos**. Abaixo disso a
 * criação da order falha.
 *
 * Este número é a razão pela qual a janela de pagamento do avulso online subiu
 * de 10 para 30 minutos (decisão do dono, 2026-08-26): com a AbacatePay pedíamos
 * ao gateway exatamente a janela da reserva, para que um PIX pago não pudesse
 * confirmar uma reserva já morta. O Mercado Pago não aceita menos que isto.
 */
export const PIX_EXPIRACAO_MINIMA_SEGUNDOS = 30 * 60;

/** Teto do Mercado Pago para expiração de PIX: 30 dias. */
export const PIX_EXPIRACAO_MAXIMA_SEGUNDOS = 30 * 24 * 60 * 60;

/**
 * `1800` → `"PT30M"`, `3600` → `"PT1H"`, `5430` → `"PT1H30M30S"`.
 *
 * Componentes com valor zero são OMITIDOS (`3600` não vira `"PT1H0M0S"`), que é
 * o que a doc mostra. Duração zero ou negativa lança: pedir ao gateway um prazo
 * que já passou não é um caso a tratar com silêncio.
 */
export function segundosParaDuracaoIso(segundos: number): string {
  if (!Number.isInteger(segundos)) {
    throw new InvarianteVioladaError(`Duração exige segundos inteiros, recebido: ${segundos}`);
  }
  if (segundos <= 0) {
    throw new InvarianteVioladaError(
      `Duração deve ser positiva, recebido: ${segundos}. Um prazo de expiração já vencido não é enviável.`,
    );
  }

  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const restoSegundos = segundos % 60;

  const partes = [
    horas > 0 ? `${horas}H` : '',
    minutos > 0 ? `${minutos}M` : '',
    restoSegundos > 0 ? `${restoSegundos}S` : '',
  ].join('');

  return `PT${partes}`;
}

/**
 * Confere a janela contra os limites do Mercado Pago ANTES de montar o payload.
 *
 * Existe separado do conversor porque o conversor é genérico (ISO 8601 não tem
 * opinião sobre prazo mínimo de PIX) e porque a mensagem de erro precisa dizer
 * de onde vem o limite — quem topar com ela vai querer saber se pode mudar o
 * número, e a resposta é "não, é do gateway".
 */
export function assertJanelaPixValida(segundos: number): void {
  if (segundos < PIX_EXPIRACAO_MINIMA_SEGUNDOS) {
    throw new InvarianteVioladaError(
      `Janela de expiração do PIX de ${segundos}s é menor que o mínimo do Mercado Pago ` +
        `(${PIX_EXPIRACAO_MINIMA_SEGUNDOS}s = 30 min). Não é ajustável do nosso lado: a criação da order falharia.`,
    );
  }
  if (segundos > PIX_EXPIRACAO_MAXIMA_SEGUNDOS) {
    throw new InvarianteVioladaError(
      `Janela de expiração do PIX de ${segundos}s excede o máximo do Mercado Pago ` +
        `(${PIX_EXPIRACAO_MAXIMA_SEGUNDOS}s = 30 dias).`,
    );
  }
}
