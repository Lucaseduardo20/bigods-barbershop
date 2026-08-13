export enum Papel {
  ADMIN = 'ADMIN',
  BARBEIRO = 'BARBEIRO',
}

export enum StatusAtendimento {
  AGENDADO = 'AGENDADO',
  CONCLUIDO = 'CONCLUIDO',
  CANCELADO = 'CANCELADO',
  NAO_COMPARECEU = 'NAO_COMPARECEU',
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
