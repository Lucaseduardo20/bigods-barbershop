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

/**
 * SENHA DO CLIENTE (2026-08-28) — força mínima, sem exagero.
 *
 * O cliente é uma pessoa marcando corte no celular, não um administrador de
 * sistema. Exigir maiúscula, símbolo e número transforma o primeiro acesso num
 * campo de batalha e empurra todo mundo para "Senha@123" — que não é mais
 * segura, só mais irritante de digitar.
 *
 * O que de fato protege aqui é o conjunto: comprimento mínimo honesto, recusa
 * das senhas óbvias, e o rate limit do login por telefone (5 tentativas / 10
 * min) que já existe. Uma senha de 8 caracteres atrás desse limite é
 * inatacável por força bruta na prática.
 *
 * Recusar o PRÓPRIO TELEFONE é a única regra "esperta", e existe porque é a
 * escolha natural de quem acabou de digitar o telefone na tela anterior — e a
 * única que um atacante tentaria primeiro, já que o telefone é o login.
 */
export const SENHA_MIN = 8;
export const SENHA_MAX = 72;

/** As que qualquer um tenta primeiro. Comparadas só depois de normalizar. */
const SENHAS_OBVIAS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'senha123',
  'password',
  'qwertyui',
  'abcd1234',
  '11111111',
  '00000000',
  'bigods123',
]);

export interface ProblemaDeSenha {
  ok: boolean;
  /** Mensagem pronta para a tela. `null` quando está tudo certo. */
  erro: string | null;
}

/**
 * A regra vale nas DUAS pontas: o front chama para dar feedback enquanto o
 * cliente digita, o back chama na borda porque validação só no front é um curl
 * de distância.
 *
 * `telefone` é opcional só para o front poder validar antes de saber o número;
 * o back SEMPRE passa, e é lá que a recusa vale.
 */
export function validarSenhaDeCliente(senha: string, telefone?: string): ProblemaDeSenha {
  const valor = String(senha ?? '');
  if (valor.length < SENHA_MIN) {
    return { ok: false, erro: `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.` };
  }
  if (valor.length > SENHA_MAX) {
    return { ok: false, erro: `A senha pode ter no máximo ${SENHA_MAX} caracteres.` };
  }
  // Espaço em branco puro não é senha; nas pontas ele ainda vira 8 caracteres.
  if (!valor.trim()) {
    return { ok: false, erro: 'A senha não pode ser só espaços.' };
  }
  if (SENHAS_OBVIAS.has(valor.toLowerCase())) {
    return { ok: false, erro: 'Essa senha é fácil demais de adivinhar. Escolha outra.' };
  }
  if (telefone) {
    const digitosDoTelefone = somenteDigitos(telefone);
    const digitosDaSenha = somenteDigitos(valor);
    if (digitosDoTelefone.length >= 8 && digitosDaSenha && digitosDoTelefone.endsWith(digitosDaSenha)) {
      return { ok: false, erro: 'A senha não pode ser o seu telefone.' };
    }
  }
  return { ok: true, erro: null };
}
