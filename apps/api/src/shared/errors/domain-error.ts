export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvarianteVioladaError extends DomainError {}
export class TransicaoDeEstadoInvalidaError extends DomainError {}
