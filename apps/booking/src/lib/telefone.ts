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
