import { useRef, useState } from 'react';
import type {
  ConfirmarLoginClienteResponse,
  IniciarLoginClienteResponse,
} from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { linkDeContaComSessao } from '../lib/handoff';

const ACCOUNT_URL = (import.meta.env.VITE_ACCOUNT_URL as string | undefined) ?? 'http://localhost:5175';
const N = 6;

/**
 * Onboarding suave pós-compra de pacote (Fase 4): o cliente que acabou de pagar
 * já pode "criar seu acesso" ali mesmo, sem descobrir depois como logar. Reusa o
 * MESMO fluxo de OTP da área do cliente (POST /conta/login/iniciar + confirmar) —
 * a provisão do usuário já foi disparada pelo PacoteVendido/PagamentoConfirmado.
 * Opcional: dá pra pular.
 */
export function Onboarding({ telefone }: { telefone: string }) {
  const [fase, setFase] = useState<'oferta' | 'codigo' | 'pronto'>('oferta');
  const [desafio, setDesafio] = useState('');
  const [codigoDemo, setCodigoDemo] = useState<string | null>(null);
  const [digitos, setDigitos] = useState<string[]>(Array(N).fill(''));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [sessao, setSessao] = useState<ConfirmarLoginClienteResponse | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const iniciar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<IniciarLoginClienteResponse>('/conta/login/iniciar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone },
      });
      setDesafio(r.desafio);
      setCodigoDemo(r.codigoDemo);
      setFase('codigo');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  const confirmar = async (codigo: string) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<ConfirmarLoginClienteResponse>('/conta/login/confirmar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone, codigo, desafio },
      });
      setSessao(r);
      setFase('pronto');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
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

  if (fase === 'pronto') {
    return (
      <div className="rounded-2xl p-4 text-center" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
        <div className="text-[15px] font-extrabold">Acesso criado! 🎉</div>
        <div className="text-[13px] mt-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
          Agora é só entrar na sua conta para usar os créditos quando quiser.
        </div>
        <a
          href={sessao ? linkDeContaComSessao(ACCOUNT_URL, sessao) : ACCOUNT_URL}
          className="btn btn-block"
          style={{ textDecoration: 'none' }}
        >
          Ir para minha conta →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
      <div className="text-[15px] font-extrabold">Crie seu acesso agora</div>
      <div className="text-[13px] mt-1 mb-3" style={{ color: 'var(--text-secondary)' }}>
        Confirme seu telefone e use seus créditos direto pela sua conta, quando quiser.
      </div>

      {fase === 'oferta' && (
        <button className="btn btn-block" disabled={ocupado} onClick={iniciar}>
          {ocupado ? 'Enviando…' : 'Receber código por SMS'}
        </button>
      )}

      {fase === 'codigo' && (
        <>
          <div className="flex gap-1.5 justify-center mb-2">
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
                  width: 40,
                  height: 50,
                  textAlign: 'center',
                  fontSize: 20,
                  fontWeight: 800,
                  borderRadius: 10,
                  outline: 'none',
                  background: 'var(--surface-app)',
                  border: `1.5px solid ${erro ? 'var(--status-danger)' : d ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                }}
              />
            ))}
          </div>
          {codigoDemo && (
            <div className="text-[12px] text-center" style={{ color: 'var(--text-muted)' }}>
              modo demo — seu código é <strong style={{ color: 'var(--text-primary)' }}>{codigoDemo}</strong>
            </div>
          )}
        </>
      )}

      {erro && <div className="text-[13px] font-semibold text-center mt-2" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
    </div>
  );
}
