/**
 * Prazo padrão entre o admin decidir devolver e a devolução ser EXECUTADA.
 *
 * ## De onde vem o número
 *
 * Decisão do dono (2026-08-26): 31 dias, "assim poderemos receber juros do valor
 * para pagar a taxa do Mercado Pago que tivemos de prejuízo".
 *
 * ★ A premissa NÃO se confirma na documentação: o Mercado Pago **estorna a taxa de
 * venda** junto com o reembolso e não cobra tarifa pelo processo. Não há taxa
 * perdida a compensar. O dono foi informado e manteve a decisão — o agendamento
 * segue útil por outros motivos (janela de arrependimento do cliente, conferência
 * manual antes de mover dinheiro). Registrado em `followup.md` #2 para que a
 * justificativa não seja tomada como fato técnico no futuro.
 *
 * ## Por que é padrão e não regra
 *
 * O prazo é editável POR SOLICITAÇÃO na tela do admin, não só por env. Um prazo
 * global escondido obrigaria a mexer em configuração de deploy para tratar um caso
 * — e casos existem: cliente reclamando, valor alto, erro da própria barbearia.
 * A env define o default; a tela decide cada um.
 *
 * `0` significa **agora**, e é como "executar imediato" e "antecipar" são
 * expressos. Um valor separado (`imediato: true`) criaria dois caminhos para a
 * mesma coisa.
 */

export interface ConfigReembolso {
  /** Dias até a execução, quando a solicitação não especifica. `0` = imediato. */
  readonly prazoDiasPadrao: number;
}

export const CONFIG_REEMBOLSO = Symbol('ConfigReembolso');

const PRAZO_PADRAO_DIAS = 31;

/**
 * Teto de sanidade: 180 dias.
 *
 * É o prazo máximo de estorno de cartão no Mercado Pago. Agendar além disso
 * garantiria uma falha no dia da execução — e falharia depois de o cliente ter
 * esperado meio ano, que é o pior momento possível para descobrir.
 */
const PRAZO_MAXIMO_DIAS = 180;

export function lerConfigReembolso(env: NodeJS.ProcessEnv = process.env): ConfigReembolso {
  return { prazoDiasPadrao: validarPrazoDias(env.REEMBOLSO_PRAZO_DIAS, PRAZO_PADRAO_DIAS) };
}

/**
 * Valida um prazo em dias. Devolve `padrao` para ausente/vazio; **lança** para
 * qualquer outra coisa.
 *
 * Usada nos dois lugares em que um prazo entra no sistema — a env, no boot, e o
 * corpo da requisição do admin — porque a regra é a mesma e duplicá-la faria uma
 * das duas ficar para trás. Um `"31 dias"` ou um `"-1"` precisa morrer antes de
 * virar `agendadaPara`, que é uma data que ninguém revisa depois.
 */
export function validarPrazoDias(bruto: string | number | undefined, padrao: number): number {
  if (bruto === undefined || bruto === '') return padrao;
  const n = typeof bruto === 'number' ? bruto : Number(bruto);
  if (!Number.isInteger(n) || n < 0 || n > PRAZO_MAXIMO_DIAS) {
    throw new Error(
      `Prazo de reembolso inválido: ${JSON.stringify(bruto)}. Use um INTEIRO de dias entre 0 e ` +
        `${PRAZO_MAXIMO_DIAS} (0 = executar agora). ${PRAZO_MAXIMO_DIAS} é o prazo máximo de ` +
        'estorno de cartão no Mercado Pago — além dele a execução falharia com certeza.',
    );
  }
  return n;
}

/**
 * Quando executar, dado o prazo em dias.
 *
 * Soma em MILISSEGUNDOS sobre o instante, de propósito, e não em "dia civil": o
 * agendamento é um prazo de espera, não uma data de calendário. Um cálculo por dia
 * civil traria fuso e horário de verão para dentro de uma decisão que não depende
 * de nenhum dos dois — e este projeto já paga esse imposto onde ele é necessário
 * (agenda), sem precisar pagá-lo aqui.
 */
export function instanteDaExecucao(agora: Date, prazoDias: number): Date {
  return new Date(agora.getTime() + prazoDias * 86_400_000);
}
