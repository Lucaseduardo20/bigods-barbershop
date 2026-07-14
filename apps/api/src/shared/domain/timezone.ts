import { InvarianteVioladaError } from '../errors/domain-error';

/**
 * Fuso horário IANA (ex: "America/Sao_Paulo"). Propriedade da Company, não uma
 * constante global — outras barbearias em outros fusos usarão o sistema.
 */
export class Timezone {
  private constructor(readonly iana: string) {}

  static de(iana: string): Timezone {
    if (!Timezone.valido(iana)) {
      throw new InvarianteVioladaError(`Timezone IANA inválido: ${iana}`);
    }
    return new Timezone(iana);
  }

  static valido(iana: string): boolean {
    try {
      // eslint-disable-next-line no-new
      new Intl.DateTimeFormat('en-US', { timeZone: iana });
      return true;
    } catch {
      return false;
    }
  }

  equals(outro: Timezone): boolean {
    return this.iana === outro.iana;
  }
}
