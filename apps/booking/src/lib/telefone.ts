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
 * E.164 para uso no navegador — necessário SÓ no adapter do Cognito, onde o
 * telefone é o `username` enviado direto ao User Pool e não passa antes pela
 * nossa API.
 *
 * A autoridade sobre normalização continua sendo o VO `Telefone` do backend
 * (que é quem grava e reconcilia); isto é o mínimo para o Amplify falar com o
 * Cognito, e o backend renormaliza tudo que recebe de volta de qualquer forma.
 */
export function paraE164(entrada: string): string {
  const d = entrada.replace(/\D/g, '');
  if (entrada.trim().startsWith('+')) return `+${d}`;
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  return `+${d}`;
}
