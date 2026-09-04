import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { Dinheiro } from '../../../shared/domain/dinheiro';

/**
 * Conversão entre `Dinheiro` (centavos inteiros) e o formato monetário da Orders
 * API do Mercado Pago: **string de reais com duas casas** — `"50.00"`.
 *
 * ## Por que isto é um módulo próprio, e não um método de `Dinheiro`
 *
 * `Dinheiro` é o VO do domínio e não conhece gateway nenhum. Esta é uma tradução
 * de BORDA, específica de um provedor: a AbacatePay recebe centavos inteiros
 * (`amount: 5000`), o Mercado Pago recebe string de reais (`total_amount:
 * "50.00"`). Colocar as duas em `Dinheiro` faria o VO carregar conhecimento de
 * infraestrutura, o que o CLAUDE.md proíbe.
 *
 * O arquivo mora em `domain/` porque é TypeScript puro e testável sem nada —
 * mas ele é usado pelo adapter, na borda.
 *
 * ## Por que nenhum float, em nenhum sentido
 *
 * `parseFloat("0.07") * 100` dá `7.000000000000001`, e `(9997/100).toFixed(2)`
 * depende de arredondamento de ponto flutuante. Um centavo perdido num pagamento
 * é dinheiro real que não fecha na conciliação. Então:
 *
 * - **Emitir** é manipulação de STRING: `9997` → `"9997"` → `"99" + "." + "97"`.
 *   Nenhuma divisão acontece.
 * - **Ler** é aritmética INTEIRA: as casas decimais são normalizadas para duas e
 *   somadas como inteiro (`Number("99") * 100 + Number("97")`).
 */

/**
 * Formato aceito na LEITURA. A documentação da Orders API diz que o campo "pode
 * conter duas casas decimais ou nenhuma", então `"50"` e `"50.00"` são ambos
 * válidos. Aceitamos também uma casa (`"50.5"`) por tolerância na leitura — é
 * resposta de terceiro, e recusar um formato que o Mercado Pago um dia emita
 * derrubaria a confirmação de um pagamento que já aconteceu.
 *
 * Na ESCRITA sempre emitimos duas casas, que é o que os exemplos da doc mostram.
 *
 * O limite de 15 dígitos inteiros existe para o resultado caber com folga em
 * inteiro seguro de JS depois de multiplicar por 100.
 */
const FORMATO_REAIS = /^(\d{1,15})(?:\.(\d{1,2}))?$/;

/** `Dinheiro.deCentavos(9997)` → `"99.97"`. Sempre duas casas, sempre sem sinal. */
export function paraStringDeReais(valor: Dinheiro): string {
  // padStart(3) garante pelo menos "0XX", para que 5 centavos virem "0.05" e não
  // ".05" ou "0.5" — o caso que quebra num valor abaixo de um real.
  const digitos = String(valor.centavos).padStart(3, '0');
  return `${digitos.slice(0, -2)}.${digitos.slice(-2)}`;
}

/**
 * `"99.97"` → `Dinheiro.deCentavos(9997)`.
 *
 * Lança `InvarianteVioladaError` em qualquer coisa que não seja um valor
 * monetário não-negativo — inclusive nas formas que um `parseFloat` aceitaria
 * calado: `"1e3"`, `"50abc"`, `" "`, `"-5"`, `"50.123"`.
 */
export function deStringDeReais(texto: string): Dinheiro {
  const casada = FORMATO_REAIS.exec(texto.trim());
  if (!casada) {
    throw new InvarianteVioladaError(
      `Valor monetário do Mercado Pago em formato inesperado: ${JSON.stringify(texto)}. ` +
        'Esperado string de reais não-negativa, com no máximo duas casas decimais (ex.: "50.00").',
    );
  }
  const inteiros = casada[1]!;
  // padEnd, não padStart: em "50.5" o 5 são cinquenta centavos, não cinco.
  const decimais = (casada[2] ?? '').padEnd(2, '0');
  return Dinheiro.deCentavos(Number(inteiros) * 100 + Number(decimais));
}
