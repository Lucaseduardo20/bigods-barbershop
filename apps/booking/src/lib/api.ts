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

/** Cliente HTTP do funil público — sem token, sem sessão (superfície não autenticada). */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new ApiError(res.status, msg ?? `Erro ${res.status}`);
  }
  return data as T;
}
