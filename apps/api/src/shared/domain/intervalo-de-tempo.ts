import { InvarianteVioladaError } from '../errors/domain-error';
import { Duracao } from './duracao';

/**
 * Intervalo temporal semiaberto [inicio, fim).
 * Semiaberto para que um atendimento que termina 10:30 não conflite
 * com outro que começa 10:30.
 */
export class IntervaloDeTempo {
  private constructor(
    readonly inicio: Date,
    readonly fim: Date,
  ) {}

  static de(inicio: Date, fim: Date): IntervaloDeTempo {
    if (inicio.getTime() >= fim.getTime()) {
      throw new InvarianteVioladaError(
        `Intervalo inválido: início (${inicio.toISOString()}) deve ser antes do fim (${fim.toISOString()})`,
      );
    }
    return new IntervaloDeTempo(new Date(inicio), new Date(fim));
  }

  static aPartirDe(inicio: Date, duracao: Duracao): IntervaloDeTempo {
    return IntervaloDeTempo.de(inicio, new Date(inicio.getTime() + duracao.minutos * 60_000));
  }

  sobrepoe(outro: IntervaloDeTempo): boolean {
    return this.inicio.getTime() < outro.fim.getTime() && outro.inicio.getTime() < this.fim.getTime();
  }

  contem(outro: IntervaloDeTempo): boolean {
    return this.inicio.getTime() <= outro.inicio.getTime() && outro.fim.getTime() <= this.fim.getTime();
  }

  equals(outro: IntervaloDeTempo): boolean {
    return this.inicio.getTime() === outro.inicio.getTime() && this.fim.getTime() === outro.fim.getTime();
  }
}
