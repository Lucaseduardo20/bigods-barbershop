import { StatusDoClube, StatusItemPacote, StatusPagamento, TipoEventoClube } from '@bigods/contracts';

/**
 * ESTADO DO CLIENTE NO BIGOD'S CLUB — função pura (2026-08-21).
 *
 * ★ O status é sempre CALCULADO, nunca armazenado. Um campo `status` no banco
 * divergiria do cálculo na primeira vez que alguém esquecesse de atualizá-lo;
 * um cálculo só não tem com o que divergir. O log de eventos existe para
 * auditoria e métrica futura — ele NÃO é lido para saber o status de agora.
 *
 * ## Os três estados
 *
 * - `MEMBRO_ATIVO` — tem crédito VIVO em pacote pago.
 * - `MEMBRO_INATIVO` — sem crédito vivo, e sem avulso marcado desde então.
 *   Esgotar ou expirar o pacote NÃO expulsa ninguém: continua membro.
 * - `NAO_MEMBRO` — nunca teve pacote pago, OU estava inativo e marcou um avulso
 *   depois de ficar sem crédito (sinalizou que não vai renovar agora).
 *
 * ## Duas decisões que não são óbvias
 *
 * **Crédito AGENDADO conta como vivo.** A regra falada é "crédito disponível", e
 * um item AGENDADO literalmente não está disponível para marcar outro horário.
 * Mas quem tem visita de pacote marcada é o oposto de esgotado — rebaixá-lo a
 * inativo, com "renove!" na tela, enquanto ele tem crédito em voo seria errado.
 * O crédito volta a DISPONIVEL se ele cancelar. Mesmo raciocínio para
 * SEGUNDA_CHANCE: o crédito ainda existe, só está com prazo.
 *
 * **O avulso é datado pela MARCAÇÃO, não pelo atendimento.** É por isso que
 * `Atendimento.criadoEm` existe. Se comparássemos pelo `inicio`, um avulso
 * marcado por quem TINHA crédito (e portanto não deveria mudar nada) passaria a
 * rebaixá-lo mais tarde, assim que os créditos acabassem — bastava o avulso
 * estar agendado para depois. A regra "pacote ativo protege o status" tem que
 * valer para sempre, não só no instante do clique.
 */

/** O que o cálculo precisa saber de um crédito de pacote. */
export interface CreditoParaStatus {
  /** Só pacote PAGO conta: crédito de pacote não pago não existe ainda. */
  statusPagamentoDaVenda: StatusPagamento;
  statusDoItem: StatusItemPacote;
  /**
   * Instante em que este crédito deixou de estar vivo — `fim` do atendimento
   * que o consumiu, ou o prazo que o expirou. `null` para crédito ainda vivo.
   */
  deixouDeViverEm: Date | null;
}

/** O que o cálculo precisa saber de um avulso. */
export interface AvulsoParaStatus {
  /** Quando foi MARCADO (não quando acontece). */
  criadoEm: Date;
}

const VIVOS: ReadonlySet<StatusItemPacote> = new Set([
  StatusItemPacote.DISPONIVEL,
  StatusItemPacote.SEGUNDA_CHANCE,
  StatusItemPacote.AGENDADO,
]);

export function statusDoClube(params: {
  creditos: readonly CreditoParaStatus[];
  avulsos: readonly AvulsoParaStatus[];
}): StatusDoClube {
  const dePacotePago = params.creditos.filter(
    (c) => c.statusPagamentoDaVenda === StatusPagamento.PAGO,
  );

  if (dePacotePago.some((c) => VIVOS.has(c.statusDoItem))) {
    return StatusDoClube.MEMBRO_ATIVO;
  }
  // Nunca teve pacote pago: não é ex-membro, é quem nunca entrou.
  if (dePacotePago.length === 0) {
    return StatusDoClube.NAO_MEMBRO;
  }

  const instanteSemCredito = dePacotePago
    .map((c) => c.deixouDeViverEm)
    .filter((d): d is Date => d !== null)
    .reduce<Date | null>((maior, d) => (maior === null || d > maior ? d : maior), null);

  // Sem instante conhecido (dado antigo, item sem rastro), o benefício da dúvida
  // é ficar NO clube: o erro de manter um membro é menor que o de expulsar quem
  // não pediu para sair.
  if (instanteSemCredito === null) {
    return StatusDoClube.MEMBRO_INATIVO;
  }

  const marcouAvulsoDepois = params.avulsos.some((a) => a.criadoEm > instanteSemCredito);
  return marcouAvulsoDepois ? StatusDoClube.NAO_MEMBRO : StatusDoClube.MEMBRO_INATIVO;
}

/**
 * Que evento registrar numa transição — ou `null` quando não houve transição
 * (é isso que dá idempotência ao log: reconciliar duas vezes não grava duas).
 *
 * `jaFoiMembro` distingue quem está entrando pela primeira vez de quem está
 * voltando; vem da existência de evento anterior no log.
 */
export function eventoDaTransicao(params: {
  anterior: StatusDoClube;
  novo: StatusDoClube;
  jaFoiMembro: boolean;
}): TipoEventoClube | null {
  const { anterior, novo, jaFoiMembro } = params;
  if (anterior === novo) return null;

  if (novo === StatusDoClube.MEMBRO_ATIVO) {
    return jaFoiMembro ? TipoEventoClube.RENOVOU : TipoEventoClube.ENTROU_CLUBE;
  }
  if (novo === StatusDoClube.MEMBRO_INATIVO) {
    // De NAO_MEMBRO para INATIVO não acontece por caminho normal (sem crédito
    // vivo, quem já saiu não volta a inativo sem comprar) — mas se acontecer,
    // é reentrada no clube, não "virou inativo".
    return anterior === StatusDoClube.MEMBRO_ATIVO
      ? TipoEventoClube.VIROU_INATIVO
      : TipoEventoClube.RENOVOU;
  }
  // novo === NAO_MEMBRO
  return TipoEventoClube.SAIU_CLUBE;
}
