export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvarianteVioladaError extends DomainError {}
export class TransicaoDeEstadoInvalidaError extends DomainError {}

/**
 * Conflito de horário (invariante de sobreposição, §2.7). Subtipo próprio para
 * que a borda HTTP troque a mensagem técnica (com id de atendimento) por uma
 * mensagem amigável ao cliente — bug 3: o texto cru vazava UUID e jargão.
 */
export class ConflitoDeHorarioError extends InvarianteVioladaError {}
