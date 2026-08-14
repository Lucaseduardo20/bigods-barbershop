/**
 * Regras de validação de entrada compartilhadas back ↔ front.
 *
 * Elas precisam valer nas DUAS pontas — no front para o cliente receber
 * feedback imediato, no back porque validação só no front é contornável (basta
 * um curl). Mas "a mesma regra em dois lugares" é anti-padrão explícito
 * (CLAUDE.md): se as duas cópias divergirem, o front passa a barrar o que o
 * back aceita, ou pior, o contrário.
 *
 * A saída é esta: a regra mora AQUI, em TypeScript puro sem framework, e as
 * duas pontas a importam. O front chama direto; o back embrulha em
 * `class-validator` na borda dos DTOs.
 *
 * Não confundir com invariante de domínio: isto é validação de ENTRADA (formato
 * do que o cliente digitou). As invariantes de negócio continuam no domínio.
 */

function somenteDigitos(entrada: string): string {
  return String(entrada ?? '').replace(/\D/g, '');
}

/**
 * Celular brasileiro válido — o que o funil exige, porque o código de
 * verificação vai por WhatsApp e telefone fixo nunca vai recebê-lo.
 *
 * A regra é o dígito que segue o DDD ser 9 (padrão de celular no Brasil desde a
 * migração do nono dígito). Note que a checagem é no primeiro dígito do NÚMERO,
 * nunca no primeiro caractere digitado: "11 99999-8888" começa com 1, e é
 * válido; "99 88888-7777" começa com 9, e é inválido (o número começa com 8).
 *
 * Aceita com ou sem o código do país (+55). Fixo (8 dígitos após o DDD) é
 * recusado de propósito.
 */
export function celularBrasileiroValido(entrada: string): boolean {
  const digitos = somenteDigitos(entrada);
  // 55 só é código de país quando sobra número suficiente depois dele — sem
  // isso, um celular de DDD 55 (RS) seria decapitado.
  const semPais = digitos.length >= 12 && digitos.startsWith('55') ? digitos.slice(2) : digitos;

  if (semPais.length !== 11) return false; // 2 (DDD) + 9 (celular)
  const ddd = Number(semPais.slice(0, 2));
  if (!Number.isFinite(ddd) || ddd < 11 || ddd > 99) return false;
  return semPais[2] === '9';
}

/**
 * Nome utilizável para chamar o cliente. Barra "a", "aa", só espaços e
 * pontuação solta, sem barrar nome legítimo curto — "Ana", "Léo" e "Bia"
 * passam, e é por isso que NÃO exigimos duas palavras (muita gente digita só o
 * primeiro nome, e recusar isso seria atrito inventado).
 *
 * O mínimo é 3 caracteres com pelo menos 2 letras distintas: pega "aaa" e
 * "..." sem pegar ninguém de verdade.
 */
export function nomeDeClienteValido(nome: string): boolean {
  const limpo = String(nome ?? '').trim().replace(/\s+/g, ' ');
  if (limpo.length < 3) return false;
  const letras = limpo.toLowerCase().match(/\p{L}/gu) ?? [];
  return new Set(letras).size >= 2;
}

/**
 * E-mail — só formato, e só quando preenchido (o campo é OPCIONAL no funil).
 * Deliberadamente permissivo: e-mail válido de verdade só se prova enviando, e
 * regex ambiciosa demais recusa endereço legítimo. Vazio/nulo não é erro:
 * quem decide se pode faltar é quem chama.
 */
export function emailValido(email: string): boolean {
  const limpo = String(email ?? '').trim();
  if (limpo.length === 0 || limpo.length > 254) return false;
  if (/\s/.test(limpo)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(limpo);
}

/** Vazio/ausente conta como "não informado" — não como inválido. */
export function preenchido(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && valor.trim().length > 0;
}

/**
 * Janela máxima de agendamento: o cliente não marca para depois de hoje + N
 * dias. Existe para a agenda não virar promessa de longo prazo que a barbearia
 * não consegue honrar (preço muda, barbeiro sai, expediente muda).
 *
 * Vale só para o auto-atendimento (funil + cockpit) — o admin marca pelo
 * próprio julgamento, como já acontece com a cota de presenciais.
 */
export const LIMITE_DIAS_AGENDAMENTO = 30;

/** Teto do texto livre de "Fale sobre você" — evita payload abusivo. */
export const MAX_SOBRE_VOCE = 500;
