/**
 * A área do cliente é o deploy da própria barbearia — tenant explícito e
 * constante em build-time (sem resolução implícita de empresa, DOMAIN.md §2.4).
 */
export const COMPANY_ID = (import.meta.env.VITE_COMPANY_ID as string | undefined) ?? 'bigods';

/** URL do funil público (para "comprar novo pacote" / "primeiro horário"). */
export const BOOKING_URL = (import.meta.env.VITE_BOOKING_URL as string | undefined) ?? 'http://localhost:5174';
