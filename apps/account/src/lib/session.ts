import type { ClienteSessaoDTO } from '@bigods/contracts';

/**
 * Sessão do cliente = token HMAC emitido pela API na confirmação do OTP, guardado
 * no localStorage (persiste entre visitas — é a "área logada"). Não é o token de
 * staff; superfícies separadas (DOMAIN.md §1).
 */
const CHAVE = 'bigods.account.v1';

export interface SessaoCliente {
  token: string;
  cliente: ClienteSessaoDTO;
}

export function carregarSessao(): SessaoCliente | null {
  try {
    const raw = localStorage.getItem(CHAVE);
    return raw ? (JSON.parse(raw) as SessaoCliente) : null;
  } catch {
    return null;
  }
}

export function salvarSessao(sessao: SessaoCliente): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(sessao));
  } catch {
    /* storage indisponível */
  }
}

export function limparSessao(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    /* ignore */
  }
}
