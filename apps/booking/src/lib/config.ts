/**
 * O funil é o deploy da própria barbearia — o tenant é explícito e constante em
 * build-time (não há resolução implícita de empresa no servidor, DOMAIN.md §2.4).
 * Configurável por `VITE_COMPANY_ID`; default = a única empresa seedada.
 */
export const COMPANY_ID = (import.meta.env.VITE_COMPANY_ID as string | undefined) ?? 'bigods';
