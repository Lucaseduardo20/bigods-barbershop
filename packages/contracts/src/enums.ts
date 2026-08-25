export enum Papel {
  ADMIN = 'ADMIN',
  BARBEIRO = 'BARBEIRO',
}

export enum StatusAtendimento {
  /**
   * Reserva TEMPORÁRIA de horário, pendente de pagamento online (avulso
   * online ou pacote — sessão de OTP+reserva). Participa da invariante de
   * conflito de horário (domínio + EXCLUDE) igual a AGENDADO, mas ainda não
   * é firme: expira por timeout (`Atendimento.reservaOnlineExpiraEm`) se o
   * pagamento não confirmar a tempo → RESERVA_EXPIRADA.
   */
  RESERVADO = 'RESERVADO',
  AGENDADO = 'AGENDADO',
  /**
   * O barbeiro concluiu ANTES do horário marcado e justificou; espera aprovação
   * do admin (2026-08-20). Nada de dinheiro acontece aqui: a comissão só nasce
   * na aprovação, e o crédito de pacote só é consumido lá — senão bastaria
   * concluir atendimentos futuros para inflar comissão.
   *
   * Ocupa o horário exatamente como AGENDADO (invariante do domínio + constraint
   * EXCLUDE): a recusa devolve o atendimento pra AGENDADO, e o horário precisa
   * estar lá esperando.
   */
  CONCLUSAO_PENDENTE = 'CONCLUSAO_PENDENTE',
  CONCLUIDO = 'CONCLUIDO',
  CANCELADO = 'CANCELADO',
  NAO_COMPARECEU = 'NAO_COMPARECEU',
  /** Final. Reserva temporária que não foi paga a tempo — libera o horário. */
  RESERVA_EXPIRADA = 'RESERVA_EXPIRADA',
}

export enum OrigemAtendimento {
  AVULSO = 'AVULSO',
  CREDITO_PACOTE = 'CREDITO_PACOTE',
}

export enum StatusItemPacote {
  DISPONIVEL = 'DISPONIVEL',
  AGENDADO = 'AGENDADO',
  CONSUMIDO = 'CONSUMIDO',
  SEGUNDA_CHANCE = 'SEGUNDA_CHANCE',
  EXPIRADO = 'EXPIRADO',
}

export enum StatusPagamento {
  AGUARDANDO = 'AGUARDANDO',
  PAGO = 'PAGO',
  EXPIRADO = 'EXPIRADO',
  FALHOU = 'FALHOU',
}

export enum FormaPagamento {
  DINHEIRO = 'DINHEIRO',
  PIX = 'PIX',
  CARTAO_DEBITO = 'CARTAO_DEBITO',
  CARTAO_CREDITO = 'CARTAO_CREDITO',
  /** Pago antecipadamente online (AbacatePay) — distinto do PIX cobrado no balcão. */
  PIX_ONLINE = 'PIX_ONLINE',
  /** Quitado (total ou parcialmente) com saldo residual de pacote (sessão-E, §8.7). */
  SALDO_RESIDUAL = 'SALDO_RESIDUAL',
}

/** Origem de um LancamentoComissao: serviço prestado ou produto revendido. */
export enum OrigemComissao {
  SERVICO = 'SERVICO',
  PRODUTO = 'PRODUTO',
  /**
   * Caixinha (2026-08-25): gorjeta que o cliente deu a mais. Vai 100% para o
   * barbeiro — não é receita da casa, é dinheiro que o cliente destinou a ele.
   * Origem própria, e não "serviço com percentual de 100%", porque no extrato
   * ela precisa aparecer como uma linha que o barbeiro reconhece.
   */
  CAIXINHA = 'CAIXINHA',
}

/** Workflow de aprovação de PacoteOferta (sessão-B, Fase 3). */
export enum StatusAprovacaoPacoteOferta {
  RASCUNHO = 'RASCUNHO',
  PENDENTE_APROVACAO = 'PENDENTE_APROVACAO',
  APROVADO = 'APROVADO',
  REJEITADO = 'REJEITADO',
}

/** Origem de uma janela de Disponibilidade: gerada pelo ExpedienteSemanal ou editada manualmente. */
export enum OrigemDisponibilidade {
  EXPEDIENTE = 'EXPEDIENTE',
  MANUAL = 'MANUAL',
}

/** Estado de uma SolicitacaoDeReembolso (sessão-E, §8.7) — reembolso é sempre manual, sem gateway. */
export enum StatusSolicitacaoReembolso {
  PENDENTE = 'PENDENTE',
  REEMBOLSADO = 'REEMBOLSADO',
}

/**
 * Natureza de um LancamentoComissao no ledger de 3 direções (sessão de
 * vale/pagamento): COMISSAO soma ao saldo do barbeiro, VALE e PAGAMENTO
 * subtraem. Eixo ORTOGONAL a `OrigemComissao` — origem descreve o que gerou
 * uma comissão (serviço/produto), tipo descreve a natureza do lançamento em
 * si (ganho vs. débito). Só faz sentido combinar os dois quando tipo=COMISSAO.
 */
export enum TipoLancamento {
  COMISSAO = 'COMISSAO',
  VALE = 'VALE',
  PAGAMENTO = 'PAGAMENTO',
  /**
   * Desconto que o barbeiro concedeu ao cliente no fechamento (2026-08-25): a
   * PARTE DELE, absorvida na proporção da comissão (ver `rateio-de-desconto.ts`).
   * Subtrai no saldo, como VALE e PAGAMENTO — mas é outro fato: não é dinheiro
   * que a casa entregou ao barbeiro, é comissão que ele deixou de ganhar. Um
   * tipo próprio é o que permite dizer isso no extrato.
   */
  DESCONTO_CONCEDIDO = 'DESCONTO_CONCEDIDO',
}

/**
 * Máquina de estado de um Vale (adiantamento de comissão solicitado pelo
 * barbeiro): PENDENTE → APROVADO → PAGO (só aqui nasce o débito no ledger) |
 * PENDENTE → NEGADO (final).
 */
export enum StatusVale {
  PENDENTE = 'PENDENTE',
  APROVADO = 'APROVADO',
  PAGO = 'PAGO',
  NEGADO = 'NEGADO',
}

/**
 * Estado do cliente no Bigod's Club (2026-08-21).
 *
 * ★ SEMPRE CALCULADO a partir dos pacotes e dos avulsos do cliente — nunca um
 * campo armazenado. Campo e cálculo divergem com o tempo; um só cálculo não
 * divergia de nada. O log `EventoDoClube` é histórico/auditoria, não a fonte do
 * status atual.
 */
export enum StatusDoClube {
  /** Tem crédito vivo em pacote pago (disponível, segunda chance ou já agendado). */
  MEMBRO_ATIVO = 'MEMBRO_ATIVO',
  /**
   * Sem crédito vivo, mas ainda não sinalizou saída: esgotar ou expirar o
   * pacote NÃO expulsa ninguém do clube.
   */
  MEMBRO_INATIVO = 'MEMBRO_INATIVO',
  /** Nunca teve pacote pago, ou estava inativo e marcou um avulso depois disso. */
  NAO_MEMBRO = 'NAO_MEMBRO',
}

/**
 * Transições registradas no log append-only do clube. O log NUNCA é atualizado
 * nem apagado — cada linha é um fato que aconteceu.
 */
export enum TipoEventoClube {
  /** NÃO-MEMBRO (primeira vez na vida) → ATIVO. */
  ENTROU_CLUBE = 'ENTROU_CLUBE',
  /** ATIVO → INATIVO: acabaram os créditos (consumidos ou expirados). */
  VIROU_INATIVO = 'VIROU_INATIVO',
  /** INATIVO → NÃO-MEMBRO: marcou avulso estando sem crédito. */
  SAIU_CLUBE = 'SAIU_CLUBE',
  /** INATIVO ou NÃO-MEMBRO que já foi membro antes → ATIVO (comprou de novo). */
  RENOVOU = 'RENOVOU',
}
