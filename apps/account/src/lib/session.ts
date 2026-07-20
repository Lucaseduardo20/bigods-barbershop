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

const PARAMS_SESSAO = ['token', 'clienteId', 'clienteNome', 'clienteTelefone'] as const;

/**
 * Bug 1: handoff de sessão vindo do onboarding pós-compra do app de booking
 * (origem diferente, sem acesso ao localStorage de cá). Função pura — recebe
 * a querystring já extraída para ser testável sem `window`.
 */
export function sessaoDaQuery(search: string): SessaoCliente | null {
  const params = new URLSearchParams(search);
  const token = params.get('token');
  const id = params.get('clienteId');
  const nome = params.get('clienteNome');
  const telefone = params.get('clienteTelefone');
  if (!token || !id || !nome || !telefone) return null;
  return { token, cliente: { id, nome, telefone } };
}

/** Remove os parâmetros de handoff da URL depois de consumidos (não persistir na barra de endereço). */
export function limparParametrosDeSessaoNaUrl(): void {
  try {
    const url = new URL(window.location.href);
    for (const chave of PARAMS_SESSAO) url.searchParams.delete(chave);
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* ignore */
  }
}
