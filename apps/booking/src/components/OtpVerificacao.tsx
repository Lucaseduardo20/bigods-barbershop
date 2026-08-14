import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConfirmarLoginClienteResponse } from '@bigods/contracts';
import { ApiError } from '../lib/api';
import { criarAuthAdapter } from '../lib/auth';
import { AlertaErro } from './ui';

const N = 6;

/**
 * Erros da API já vêm com mensagem tratada; os do Amplify vêm com `name`/
 * `message` da AWS (em inglês, e às vezes crus demais para o cliente final).
 * Traduz os casos que o cliente realmente encontra e mantém o resto legível.
 */
function mensagemDeErro(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  const nome = (e as { name?: string } | null)?.name;
  if (nome === 'NotAuthorizedException' || nome === 'CodeMismatchException') {
    return 'Código inválido ou expirado. Peça um novo código.';
  }
  if (nome === 'LimitExceededException' || nome === 'TooManyRequestsException') {
    return 'Muitas tentativas. Espere um pouco antes de tentar de novo.';
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Sessão de OTP+reserva (Problema 1 — agenda falsa): prova que o telefone é
 * real ANTES de reservar horário/gerar cobrança. Reusa o MESMO fluxo de OTP
 * do cockpit (`/conta/login/iniciar` + `/conta/login/confirmar`) — mesmo
 * padrão de UI do `Onboarding.tsx` (widget pós-compra), generalizado aqui
 * pra qualquer ponto do funil que precise verificar o telefone antes de agir.
 *
 * Modal (bottom-sheet), não passo próprio do funil — a Confirmação continua
 * visível por trás. Só aparece quando `Funil` decide que não há sessão local
 * válida.
 *
 * Quem prova a posse do telefone fica atrás de `criarAuthAdapter()` (ver
 * `lib/auth/`): por default a nossa API (`/conta/login/*`), e — no experimento
 * ligado por `VITE_AUTH_ADAPTER=cognito` — o Cognito via Amplify. Esta tela
 * não sabe a diferença: os dois devolvem a mesma sessão de cliente.
 */
export function OtpVerificacao({
  telefone,
  onVerificado,
  onCancelar,
}: {
  telefone: string;
  onVerificado: (sessao: ConfirmarLoginClienteResponse) => void;
  onCancelar: () => void;
}) {
  const [fase, setFase] = useState<'enviando-codigo' | 'aguardando-codigo'>('enviando-codigo');
  const [desafio, setDesafio] = useState('');
  const [codigoDemo, setCodigoDemo] = useState<string | null>(null);
  const [digitos, setDigitos] = useState<string[]>(Array(N).fill(''));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  // Um adapter por montagem do modal: o do Cognito configura o Amplify e
  // limpa a sessão anterior ao iniciar, então recriá-lo a cada render seria
  // trabalho repetido à toa.
  const auth = useMemo(() => criarAuthAdapter(), []);

  const iniciar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await auth.iniciar(telefone);
      setDesafio(r.desafio);
      setCodigoDemo(r.codigoDemo);
      setFase('aguardando-codigo');
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  };

  // Dispara sozinho ao montar — o cliente já decidiu confirmar o agendamento/
  // compra, não precisa de um clique a mais só pra "pedir o código".
  useEffect(() => {
    iniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmar = async (codigo: string) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await auth.confirmar({ telefone, codigo, desafio });
      onVerificado(r);
    } catch (e) {
      setErro(mensagemDeErro(e));
      setDigitos(Array(N).fill(''));
      refs.current[0]?.focus();
    } finally {
      setOcupado(false);
    }
  };

  const setDigito = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digitos];
    next[i] = d;
    setDigitos(next);
    setErro(null);
    if (d && i < N - 1) refs.current[i + 1]?.focus();
    if (next.every((x) => x !== '')) confirmar(next.join(''));
  };

  return (
    <div className="dialog-overlay" onClick={onCancelar}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-brand-tint)', fontSize: 22 }}
            >
              🔒
            </div>
            <div>
              <div className="text-[18px] font-extrabold leading-tight">Confirme seu telefone</div>
              <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                Leva só alguns segundos
              </div>
            </div>
          </div>
          <button className="icon-btn" style={{ fontSize: 20 }} aria-label="Fechar" onClick={onCancelar}>
            ×
          </button>
        </div>

        <div className="text-[13.5px] mb-5" style={{ color: 'var(--text-secondary)' }}>
          Enviamos um código para <strong style={{ color: 'var(--text-primary)' }}>{telefone}</strong> no WhatsApp. Ele
          prova que o horário é seu — ninguém mais consegue reservar ou pagar em seu nome.
        </div>

        {fase === 'enviando-codigo' && !erro && (
          <div className="flex flex-col items-center gap-3 py-8">
            <span className="spinner" />
            <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Enviando código…
            </span>
          </div>
        )}

        {fase === 'enviando-codigo' && erro && (
          <div className="flex flex-col gap-3">
            <AlertaErro texto={erro} />
            <button className="btn btn-block" onClick={iniciar}>
              Tentar novamente
            </button>
          </div>
        )}

        {fase === 'aguardando-codigo' && (
          <>
            <div className="flex gap-2 mb-4" style={{ justifyContent: 'space-between' }}>
              {digitos.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => (refs.current[i] = el)}
                  value={d}
                  inputMode="numeric"
                  autoFocus={i === 0}
                  disabled={ocupado}
                  onChange={(e) => setDigito(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digitos[i] && i > 0) refs.current[i - 1]?.focus();
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 54,
                    textAlign: 'center',
                    fontSize: 22,
                    fontWeight: 800,
                    fontFamily: 'var(--font-ui)',
                    borderRadius: 14,
                    outline: 'none',
                    color: 'var(--text-primary)',
                    background: d ? 'var(--surface-brand-tint)' : 'var(--surface-sunken)',
                    border: `1.5px solid ${erro ? 'var(--status-danger)' : d ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                />
              ))}
            </div>

            {codigoDemo && (
              <div className="flex items-center justify-center gap-2 mb-4">
                <span
                  className="text-[11px] font-bold uppercase"
                  style={{
                    letterSpacing: '0.04em',
                    color: 'var(--brand-gold-700)',
                    background: 'var(--surface-brand-tint)',
                    borderRadius: 999,
                    padding: '4px 10px',
                  }}
                >
                  modo demo
                </span>
                <strong className="text-[15px]" style={{ color: 'var(--text-primary)', letterSpacing: '0.05em' }}>
                  {codigoDemo}
                </strong>
              </div>
            )}

            {erro && <AlertaErro texto={erro} />}

            <button
              className="btn-ghost btn-block mt-2"
              disabled={ocupado}
              onClick={iniciar}
              style={{ fontSize: 13 }}
            >
              Reenviar código
            </button>
          </>
        )}
      </div>
    </div>
  );
}
