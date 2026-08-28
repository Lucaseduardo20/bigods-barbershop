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
  /**
   * Cartão de crédito em análise pelo emissor (Mercado Pago, 2026-08-27):
   * `status=processing` / `status_detail=in_process` na Orders API. Não é
   * AGUARDANDO (o cliente já fez a parte dele) nem FALHOU.
   *
   * O desafio 3DS (`pending_challenge`) NÃO usa este valor: ali o cliente ainda
   * tem ação a tomar e a janela de 30 min segue correndo, então é AGUARDANDO.
   *
   * Precisa existir aqui, e não só no schema do Prisma: o mapeamento de infra é
   * `StatusPagamento[row.status]`, então um valor que o banco tem e este enum
   * não teria viraria `undefined` em runtime, sem erro.
   */
  EM_ANALISE = 'EM_ANALISE',
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
  /**
   * Estorno decidido pelo admin, com execução AGENDADA (2026-08-27). Prazo
   * default de 31 dias, parametrizável por solicitação; 0 = imediato.
   */
  AGENDADO = 'AGENDADO',
  /**
   * A execução agendada chamou o gateway e falhou. Motivo mais provável: saldo
   * insuficiente na conta do Mercado Pago no dia da execução — a documentação é
   * explícita que o estorno exige saldo disponível, e a operação saca o saldo
   * para pagar barbeiro.
   *
   * Sem este estado o estorno agendado sumiria em silêncio e o cliente cobraria
   * a barbearia (followup.md #1). O texto mostrado ao CLIENTE nunca diz
   * "falhou" — quem precisa agir é a barbearia, não ele.
   */
  FALHOU = 'FALHOU',
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
  /**
   * Taxa que o gateway retém de um pagamento online (2026-08-27): a PARTE DELA
   * que sai do barbeiro, proporcional à comissão que ele receberia sobre aquele
   * valor.
   *
   * ## Por que é uma linha, e não uma base menor
   *
   * "Comissão sobre o líquido" (decisão do dono) pode ser implementado de dois
   * jeitos aritmeticamente idênticos: reduzir a base de cada item pela fração da
   * taxa, ou manter a base bruta e lançar a absorção como linha própria. O total
   * é o mesmo ao centavo.
   *
   * A linha própria vence pelo mesmo motivo que caixinha e desconto ganharam
   * linhas em 2026-08-25: uma base silenciosamente menor faria o barbeiro ver a
   * comissão dele cair sem nada explicando por quê, e desconfiança sobre
   * dinheiro é caro numa barbearia. Como linha, o extrato lê:
   *
   *     Comissão corte simples             R$ 18,00
   *     Taxa do pagamento online           − R$  0,79
   *
   * Subtrai no saldo, como VALE, PAGAMENTO e DESCONTO_CONCEDIDO — e, como o
   * desconto, não é dinheiro que a casa entregou: é comissão que ele não ganhou.
   */
  TAXA_PAGAMENTO_ONLINE = 'TAXA_PAGAMENTO_ONLINE',

  /**
   * Estornos da correção de barbeiro (2026-08-27): a comissão foi lançada para
   * quem não atendeu, e o ledger é IMUTÁVEL — o lançamento errado não é apagado
   * nem editado, é ANULADO por um de sinal oposto.
   *
   * São dois porque o sinal do estorno é o oposto do que ele anula, e o sinal
   * no saldo vem do TIPO (§3.7), nunca do valor:
   *
   *   ESTORNO_COMISSAO (−) anula o que somou    — serviço, produto, caixinha;
   *   ESTORNO_DESCONTO (+) anula o que subtraiu — o desconto que ele absorveu.
   *
   * Um tipo só, com sinal fixo, devolveria o desconto ao contrário: tiraria do
   * barbeiro errado dinheiro que ele nunca chegou a ganhar.
   */
  ESTORNO_COMISSAO = 'ESTORNO_COMISSAO',
  ESTORNO_DESCONTO = 'ESTORNO_DESCONTO',
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

/**
 * Motivo de recusa de cartão que pode ser MOSTRADO ao cliente.
 *
 * ★ Pequeno e propositalmente vago. O `status_detail` cru do gateway NUNCA vai
 * para uma resposta pública: `high_risk` diria ao fraudador "fomos pegos pelo
 * modelo de risco" e `max_attempts_exceeded` diria "o bloqueio é por tentativas,
 * espere e volte" — calibração de graça para quem está testando cartões.
 *
 * O detalhe cru fica persistido e visível só no admin.
 */
export enum MotivoPublicoDaRecusa {
  /** Algo no cartão foi digitado errado — o cliente consegue corrigir. */
  DADOS = 'DADOS',
  /** Saldo ou limite insuficiente. */
  SALDO = 'SALDO',
  /** O banco do cliente não autorizou, e não temos o porquê. */
  EMISSOR = 'EMISSOR',
  /** Qualquer outro motivo. É onde caem antifraude e motivos novos. */
  GENERICO = 'GENERICO',
}

/**
 * Por qual trilho online o cliente escolheu pagar.
 *
 * União de literais, e não `enum`, de propósito: o domínio da API já usa estas
 * strings cruas (`TentativaDePagamento.meio`) e o valor no banco é a mesma
 * string. Um `enum` aqui obrigaria conversão em cada ponto de uso sem ganhar
 * nada — diferente de `StatusPagamento`, onde a infra faz `Enum[row.status]` e
 * um valor faltando viraria `undefined` silencioso.
 *
 * ★ NÃO confundir com `FormaPagamento`, que é como o cliente pagou no BALCÃO
 * (dinheiro, débito, crédito na maquininha…). Aqui é o trilho do checkout online.
 */
export type MeioDePagamentoOnline = 'PIX' | 'CARTAO_CREDITO';

/** Desfecho de uma tentativa de pagamento com cartão, do ponto de vista do funil. */
export enum ResultadoDoCartao {
  APROVADO = 'APROVADO',
  /** O emissor aceitou processar e ainda não decidiu. */
  EM_ANALISE = 'EM_ANALISE',
  /** Precisa autenticar no banco: abrir `urlDoDesafio3ds` num iframe. */
  DESAFIO_3DS = 'DESAFIO_3DS',
  RECUSADO = 'RECUSADO',
}
