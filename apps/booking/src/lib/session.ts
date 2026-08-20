import type { ClienteSessaoDTO } from '@bigods/contracts';

/**
 * Sessão de OTP+reserva (Problema 1 — agenda falsa): o funil de agendamento
 * era 100% anônimo (sem token, sem sessão — ver `api.ts`). Agora a
 * confirmação exige prova de posse do telefone (mesmo OTP do cockpit,
 * `/conta/login/*`) — guardamos o token localmente pra um cliente que já
 * verificou o telefone NÃO precisar repetir o OTP em cada agendamento nesta
 * mesma máquina/navegador ("sessão ativa" da matriz da sessão de OTP+reserva).
 *
 * Chave PRÓPRIA (não a mesma de `apps/account`) — origens diferentes não
 * compartilham localStorage de qualquer forma, mas o nome deixa explícito
 * que é um armazenamento distinto do progresso do funil (`funnel-state.ts`
 * usa sessionStorage, isto usa localStorage — sobrevive entre visitas).
 */
const CHAVE = 'bigods.booking.sessao.v1';

export interface SessaoBooking {
  token: string;
  cliente: ClienteSessaoDTO;
}

export function carregarSessaoBooking(): SessaoBooking | null {
  try {
    const raw = localStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as SessaoBooking) : null;
  } catch {
    return null;
  }
}

export function salvarSessaoBooking(sessao: SessaoBooking): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(sessao));
  } catch {
    /* storage indisponível (modo privado) — segue sem persistir entre visitas */
  }
}

export function limparSessaoBooking(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* ignore */
  }
}
