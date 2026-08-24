/** Máscara de telefone BR: (11) 99999-9999 / (11) 9999-9999. */
export function mascararTelefone(entrada: string): string {
  const d = entrada.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Válido = DDD + 8 ou 9 dígitos (10 ou 11 no total). Backend normaliza para E.164. */
export function telefoneValido(entrada: string): boolean {
  const d = entrada.replace(/\D/g, '');
  return d.length === 10 || d.length === 11;
}

/**
 * E.164 (+5511988776655, como vem de `ClienteSessaoDTO`) → máscara local
 * legível ((11) 98877-6655) — usado no banner de "sessão ativa" (sessão de
 * OTP+reserva), pra mostrar de qual telefone é a sessão sem expor o +55 cru.
 */
export function mascararE164(e164: string): string {
  const digitos = e164.replace(/\D/g, '');
  const semPais = digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
  return mascararTelefone(semPais);
}

/**
 * Dois telefones são o MESMO número? Compara só os dígitos, porque a mesma
 * pessoa aparece em formatos diferentes na mesma tela: E.164 vindo da sessão
 * (`+5511998887777`) e o mascarado que ela digita (`(11) 99888-7777`).
 */
export function mesmoTelefone(a: string, b: string): boolean {
  const so = (t: string) => t.replace(/\D/g, '');
  const x = so(a);
  const y = so(b);
  if (!x || !y) return false;
  // Um dos lados pode ter o DDI e o outro não — compara pelo fim.
  const n = Math.min(x.length, y.length, 11);
  return x.slice(-n) === y.slice(-n);
}
