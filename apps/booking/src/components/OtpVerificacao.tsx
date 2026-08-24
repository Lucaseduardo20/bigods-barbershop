import { useEffect, useRef, useState } from 'react';
import type {
  ConfirmarLoginClienteResponse,
  IniciarLoginClienteResponse,
} from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { AlertaErro } from './ui';
import { BARBEARIA } from '../lib/barbearia';
import { IconeDeMarca } from './IconesDeMarca';

const N = 6;

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
 */
export function OtpVerificacao({
  telefone,
  motivo = 'confirmar',
  onVerificado,
  onCancelar,
}: {
  telefone: string;
  /**
   * Por que estamos pedindo o código (2026-08-21). O mecanismo é idêntico; o
   * que muda é a explicação, e explicar errado custa confiança:
   *
   * - `confirmar`: antes de reservar/cobrar — "o horário é seu".
   * - `identificar`: no passo de dados, quando o telefone JÁ tem cadastro —
   *   antes de usar (e mostrar) o nome de alguém, essa pessoa prova que o
   *   número é dela.
   */
  motivo?: 'confirmar' | 'identificar';
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
      setFase('aguardando-codigo');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  // Dispara sozinho ao montar — o cliente já decidiu confirmar o agendamento/
  // compra, não precisa de um clique a mais só pra "pedir o código".
  //
  // A guarda NÃO é preciosismo: sem ela o efeito roda duas vezes (StrictMode
  // em dev remonta de propósito, e qualquer remontagem em produção teria o
  // mesmo efeito), e cada disparo gera um desafio NOVO com um código NOVO. O
  // cliente recebia duas mensagens, só a última valia — quem digitasse o
  // primeiro código via "código inválido" mesmo tendo digitado certo — e cada
  // tentativa consumia duas das cinco do rate limit.
  const jaPediuCodigo = useRef(false);
  useEffect(() => {
    if (jaPediuCodigo.current) return;
    jaPediuCodigo.current = true;
    iniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmar = async (codigo: string) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<ConfirmarLoginClienteResponse>('/conta/login/confirmar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone, codigo, desafio },
      });
      onVerificado(r);
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
              <div className="text-[18px] font-extrabold leading-tight">
                {motivo === 'identificar' ? 'Confirme que é você' : 'Confirme seu telefone'}
              </div>
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
          Enviamos um código para <strong style={{ color: 'var(--text-primary)' }}>{telefone}</strong> via SMS.{' '}
          {motivo === 'identificar'
            ? 'Vimos que este número já tem cadastro na barbearia — confirme o código para seguirmos com os seus dados.'
            : 'Ele prova que o horário é seu, com isso ninguém mais consegue reservar ou pagar em seu nome.'}
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

        {/* Saída para gente presa aqui (go-live 2026-08-20). Fica FORA dos
            blocos por fase de propósito: SMS que não chega é justamente o caso
            em que o cliente não avança de fase nenhuma, e é aí que ele mais
            precisa de um humano.
            O contato é um BOTÃO, não um link no meio da frase: quem está
            travado precisa reconhecer a saída de relance, e um trecho
            sublinhado no meio do texto não se anuncia como algo em que clicar. */}
        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-[12.5px] text-center" style={{ color: 'var(--text-muted)' }}>
            Em caso de qualquer problema, entre em contato conosco pelo WhatsApp clicando no botão
            abaixo
          </div>
          <a
            href={`https://wa.me/${BARBEARIA.whatsapp}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost btn-block mt-2.5"
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <IconeDeMarca chave="whatsapp" tamanho={17} />
            Falar com a barbearia
          </a>
        </div>
      </div>
    </div>
  );
}
