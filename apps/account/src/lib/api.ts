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

/**
 * Cliente HTTP da área logada. Anexa o Bearer do cliente quando há sessão.
 * 401 sinaliza sessão inválida/expirada — o App reage deslogando.
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429) {
      throw new ApiError(429, mensagemDeLimite(segundosParaTentarDeNovo(res)));
    }
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new ApiError(res.status, msg ?? `Erro ${res.status}`);
  }
  return data as T;
}

/**
 * O rate limiter devolve "ThrottlerException: Too Many Requests" — texto do
 * framework, em inglês, que não diz ao cliente o que fazer nem por quanto
 * tempo. Como a API tem DOIS limites (por telefone e por origem), o cliente
 * pode bater neles em situações bem diferentes; a mensagem só precisa dizer
 * quanto esperar.
 */
export function mensagemDeLimite(segundos: number | null): string {
  if (segundos === null || !Number.isFinite(segundos) || segundos <= 0) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  }
  const minutos = Math.ceil(segundos / 60);
  if (minutos <= 1) return 'Muitas tentativas. Aguarde cerca de 1 minuto e tente de novo.';
  return `Muitas tentativas. Aguarde cerca de ${minutos} minutos e tente de novo.`;
}

/**
 * `Retry-After` do limite por telefone; `Retry-After-otp-origem` do limite por
 * origem (o @nestjs/throttler sufixa o header com o nome do throttler quando
 * ele não é o `default`). Ambos são expostos por CORS em `main.ts` da API —
 * sem isso o navegador esconde o header em produção, onde front e API vivem
 * em origens diferentes, e a mensagem cai no texto genérico.
 */
function segundosParaTentarDeNovo(res: Response): number | null {
  const bruto = res.headers.get('Retry-After') ?? res.headers.get('Retry-After-otp-origem');
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}
