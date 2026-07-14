import { InvarianteVioladaError } from '../errors/domain-error';

/** Duração em minutos (inteiro positivo). */
export class Duracao {
  private constructor(readonly minutos: number) {}

  static deMinutos(minutos: number): Duracao {
    if (!Number.isInteger(minutos) || minutos <= 0) {
      throw new InvarianteVioladaError(`Duração deve ser um inteiro positivo de minutos: ${minutos}`);
    }
    return new Duracao(minutos);
  }

  somar(outra: Duracao): Duracao {
    return new Duracao(this.minutos + outra.minutos);
  }

  equals(outra: Duracao): boolean {
    return this.minutos === outra.minutos;
  }
}
