import { ValidationOptions, registerDecorator } from 'class-validator';
import { celularBrasileiroValido, emailValido, nomeDeClienteValido } from '@bigods/contracts';

/**
 * Decorators de borda que delegam para as regras de `@bigods/contracts`.
 *
 * A regra NÃO é reimplementada aqui: o front usa exatamente as mesmas funções
 * para dar feedback imediato. O papel deste arquivo é só encaixá-las no
 * `class-validator` e definir a mensagem que o cliente lê — validação de
 * entrada na borda, como manda o CLAUDE.md (invariante de negócio continua no
 * domínio; isto é outra coisa).
 *
 * Existe porque validação só no front é contornável com um curl.
 */

function validadorSimples(
  nome: string,
  regra: (valor: string) => boolean,
  mensagemPadrao: string,
) {
  return (options?: ValidationOptions): PropertyDecorator =>
    (alvo: object, propriedade: string | symbol) => {
      registerDecorator({
        name: nome,
        target: alvo.constructor,
        propertyName: String(propriedade),
        options: { message: mensagemPadrao, ...options },
        validator: {
          validate: (valor: unknown) => typeof valor === 'string' && regra(valor),
        },
      });
    };
}

/** Celular brasileiro (dígito após o DDD = 9). Fixo é recusado — não recebe WhatsApp. */
export const EhCelularBrasileiro = validadorSimples(
  'ehCelularBrasileiro',
  celularBrasileiroValido,
  'Informe um celular válido com WhatsApp (DDD + número começando com 9).',
);

/** Nome utilizável — barra "a"/"aa"/pontuação solta sem barrar "Ana". */
export const EhNomeDeCliente = validadorSimples(
  'ehNomeDeCliente',
  nomeDeClienteValido,
  'Informe seu nome.',
);

/**
 * E-mail OPCIONAL: combine com `@IsOptional()`. Ausente/nulo não chega aqui;
 * string vazia é recusada de propósito — quem não quer informar não manda o
 * campo, em vez de mandar vazio.
 */
export const EhEmail = validadorSimples('ehEmail', emailValido, 'E-mail inválido.');
