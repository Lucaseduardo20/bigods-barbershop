import { InvarianteVioladaError } from '../errors/domain-error';

/**
 * Telefone normalizado em E.164 (ex: +5511999998888).
 * Entradas sem código de país são assumidas como Brasil (+55) —
 * a barbearia opera exclusivamente no Brasil.
 */
export class Telefone {
  private constructor(readonly e164: string) {}

  static de(entrada: string): Telefone {
    const digitos = entrada.replace(/[^\d+]/g, '');
    let normalizado: string;
    if (digitos.startsWith('+')) {
      normalizado = digitos;
    } else {
      const soDigitos = digitos.replace(/\D/g, '');
      if (soDigitos.length === 10 || soDigitos.length === 11) {
        normalizado = `+55${soDigitos}`;
      } else if (
        (soDigitos.length === 12 || soDigitos.length === 13) &&
        soDigitos.startsWith('55')
      ) {
        normalizado = `+${soDigitos}`;
      } else {
        normalizado = `+${soDigitos}`;
      }
    }
    if (!/^\+[1-9]\d{7,14}$/.test(normalizado)) {
      throw new InvarianteVioladaError(`Telefone inválido (E.164): ${entrada}`);
    }
    return new Telefone(normalizado);
  }

  equals(outro: Telefone): boolean {
    return this.e164 === outro.e164;
  }
}
