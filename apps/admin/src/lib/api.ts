import type { LoginResponse, UsuarioDTO } from '@bigods/contracts';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function token(): string | null {
  return localStorage.getItem('bigods.token');
}

export function usuarioSalvo(): UsuarioDTO | null {
  const raw = localStorage.getItem('bigods.usuario');
  return raw ? (JSON.parse(raw) as UsuarioDTO) : null;
}

export function salvarSessao(sessao: LoginResponse): void {
  localStorage.setItem('bigods.token', sessao.token);
  localStorage.setItem('bigods.usuario', JSON.stringify(sessao.usuario));
}

export function limparSessao(): void {
  localStorage.removeItem('bigods.token');
  localStorage.removeItem('bigods.usuario');
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    limparSessao();
    window.location.reload();
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new ApiError(res.status, msg ?? `Erro ${res.status}`);
  }
  return data as T;
}
