import { InvarianteVioladaError } from '../errors/domain-error';

/** Dinheiro em centavos (inteiro). Nunca float. */
export class Dinheiro {
  private constructor(readonly centavos: number) {}

  static deCentavos(centavos: number): Dinheiro {
    if (!Number.isInteger(centavos)) {
      throw new InvarianteVioladaError(`Dinheiro exige centavos inteiros, recebido: ${centavos}`);
    }
    if (centavos < 0) {
      throw new InvarianteVioladaError(`Dinheiro não pode ser negativo: ${centavos}`);
    }
    return new Dinheiro(centavos);
  }

  static zero(): Dinheiro {
    return new Dinheiro(0);
  }

  somar(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos + outro.centavos);
  }

  subtrair(outro: Dinheiro): Dinheiro {
    return Dinheiro.deCentavos(this.centavos - outro.centavos);
  }

  ehZero(): boolean {
    return this.centavos === 0;
  }

  ehPositivo(): boolean {
    return this.centavos > 0;
  }

  equals(outro: Dinheiro): boolean {
    return this.centavos === outro.centavos;
  }
}
