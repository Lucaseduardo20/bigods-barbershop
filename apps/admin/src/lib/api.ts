import type { LoginResponse, UsuarioDTO } from '@bigods/contracts';

// Relativo em dev/staging (proxy do Vite ou docker/static-server cuida do
// /api). Em produção AWS (S3+CloudFront), o frontend e a API vivem em
// domínios/origens diferentes — VITE_API_URL (setado no build) aponta pra
// URL absoluta da API. CORS já está liberado em apps/api/src/main.ts.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api';

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

/**
 * Upload de arquivo (2026-08-19) — `multipart/form-data`, não JSON. Precisa ser
 * uma função à parte porque o `Content-Type` NÃO pode ser setado à mão aqui: o
 * navegador é que escreve o `boundary` do multipart, e mandar o header fixo
 * quebra o parse no servidor de um jeito bem confuso de diagnosticar.
 *
 * Fora isso, é a mesma `api`: mesma base, mesmo token, mesmo tratamento de 401
 * e de mensagem de erro (as do upload são feitas pra serem lidas pelo usuário).
 */
export async function apiUpload<T>(path: string, arquivo: File, campo = 'arquivo'): Promise<T> {
  const form = new FormData();
  form.append(campo, arquivo);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
    body: form,
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
