import { InvarianteVioladaError } from '../errors/domain-error';
import { Dinheiro } from './dinheiro';

/**
 * Percentual armazenado em pontos-base (basis points, inteiro).
 * 45% = 4500 bp. Evita float em toda aritmética de comissão.
 */
export class Percentual {
  private constructor(readonly pontosBase: number) {}

  static dePorcentagem(porcentagem: number): Percentual {
    const pontosBase = Math.round(porcentagem * 100);
    if (!Number.isFinite(porcentagem) || pontosBase < 0 || pontosBase > 10000) {
      throw new InvarianteVioladaError(`Percentual deve estar entre 0% e 100%: ${porcentagem}`);
    }
    return new Percentual(pontosBase);
  }

  static dePontosBase(pontosBase: number): Percentual {
    if (!Number.isInteger(pontosBase) || pontosBase < 0 || pontosBase > 10000) {
      throw new InvarianteVioladaError(`Pontos-base inválidos: ${pontosBase}`);
    }
    return new Percentual(pontosBase);
  }

  get porcentagem(): number {
    return this.pontosBase / 100;
  }

  /** Aplica o percentual sobre um valor, arredondando ao centavo mais próximo. */
  aplicarEm(valor: Dinheiro): Dinheiro {
    return Dinheiro.deCentavos(Math.round((valor.centavos * this.pontosBase) / 10000));
  }

  equals(outro: Percentual): boolean {
    return this.pontosBase === outro.pontosBase;
  }
}
