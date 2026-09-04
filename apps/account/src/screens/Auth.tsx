import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { BOOKING_URL } from '../lib/config';
import { mascararTelefone, telefoneValido } from '../lib/telefone';
import { Icon, Spinner } from '../components/ui';

/* ---------------- Login (telefone + senha, com código de reserva) ---------------- */
/**
 * ★ CONTINGÊNCIA DE OTP (2026-09-04): a senha virou o caminho PRINCIPAL.
 *
 * O SMS de verificação parou de chegar de forma confiável, e quem comprou
 * pacote ficava trancado para fora da própria conta. Agora a barbearia define
 * uma senha (painel → Usuários → Clientes) e passa por WhatsApp.
 *
 * O código continua aqui embaixo, como segunda opção — nada do OTP foi
 * removido. Quando a rota de SMS voltar, os dois caminhos convivem: quem tem
 * senha entra direto, quem não tem pede o código.
 */
export function Login({
  onEntrarComSenha,
  onEnviarCodigo,
}: {
  onEntrarComSenha: (telefone: string, senha: string) => Promise<void>;
  onEnviarCodigo: (telefone: string) => Promise<void>;
}) {
  const [telefone, setTelefone] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const telefoneOk = telefoneValido(telefone);
  const ok = telefoneOk && senha.length > 0;

  const executar = async (acao: () => Promise<void>) => {
    setEnviando(true);
    setErro(null);
    try {
      await acao();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  const entrar = () => executar(() => onEntrarComSenha(telefone, senha));
  const pedirCodigo = () => executar(() => onEnviarCodigo(telefone));

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-mark">
          <img src="/brand/symbol-dark.png" alt="Bigod's Barber" style={{ width: '70%', height: 'auto' }} />
        </div>
        <div className="brand-wordmark" style={{ textAlign: 'center', fontSize: 24, color: 'var(--text-primary)' }}>
          Bigod's Barber
        </div>
        <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2 }}>
          Área do cliente
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center', margin: '6px 0 22px' }}>
          Entre com seu telefone e sua senha.
        </div>
        <label className="label">Telefone</label>
        <input
          className="input"
          inputMode="tel"
          autoComplete="username"
          placeholder="(11) 99999-9999"
          value={telefone}
          onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
        />
        <label className="label" style={{ marginTop: 12 }}>Senha</label>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ok && !enviando && entrar()}
        />
        {erro && (
          <div style={{ fontSize: 13, color: 'var(--state-danger)', marginTop: 10, fontWeight: 600 }}>{erro}</div>
        )}
        <button className="btn btn-block btn-lg" style={{ marginTop: 16 }} disabled={!ok || enviando} onClick={entrar}>
          {enviando ? <Spinner /> : 'Entrar'}
        </button>

        {/* O código continua disponível, em segundo plano: hoje ele é o caminho
            que pode não chegar, então não pode ser o botão principal — mas
            tirá-lo deixaria sem saída quem ainda não tem senha. */}
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10 }}
          disabled={!telefoneOk || enviando}
          onClick={pedirCodigo}
        >
          Não tenho senha — receber código
        </button>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
          Sem senha? Fale com a barbearia no WhatsApp que a gente cria uma para você.
        </div>
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-sunken)',
            fontSize: 12.5,
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          Primeira vez por aqui?{' '}
          <a href={BOOKING_URL} style={{ fontWeight: 700, color: 'var(--text-link)' }}>
            Agende um horário →
          </a>
        </div>
      </div>
    </div>
  );
}

/* ---------------- OTP (código) ---------------- */
const N = 6;

export function Otp({
  telefone,
  codigoDemo,
  semConta,
  onConfirmar,
  onReenviar,
  onTrocarNumero,
}: {
  telefone: string;
  codigoDemo: string | null;
  semConta: boolean;
  onConfirmar: (codigo: string) => Promise<void>;
  onReenviar: () => Promise<void>;
  onTrocarNumero: () => void;
}) {
  const [digitos, setDigitos] = useState<string[]>(Array(N).fill(''));
  const [erro, setErro] = useState<string | null>(null);
  const [neutro, setNeutro] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [contagem, setContagem] = useState(30);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (contagem <= 0) return;
    const t = setTimeout(() => setContagem((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [contagem]);

  const submeter = async (codigo: string) => {
    // Telefone sem conta: a API devolveu desafio vazio → resposta neutra, sem
    // vazar se o número é ou não cliente (mesma política do backend).
    if (semConta) {
      setNeutro(true);
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await onConfirmar(codigo);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setErro(msg);
      setDigitos(Array(N).fill(''));
      refs.current[0]?.focus();
    } finally {
      setEnviando(false);
    }
  };

  const setDigito = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digitos];
    next[i] = d;
    setDigitos(next);
    setErro(null);
    if (d && i < N - 1) refs.current[i + 1]?.focus();
    if (next.every((x) => x !== '')) submeter(next.join(''));
  };

  const onKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digitos[i] && i > 0) refs.current[i - 1]?.focus();
  };

  if (neutro) {
    return (
      <div className="auth-bg">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)', marginBottom: 10 }}>
            <Icon name="message-square" size={30} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>Não foi possível confirmar</div>
          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '8px 0 20px' }}>
            Se esse número tiver uma conta, você recebe um código válido por SMS. Confira o número ou tente de novo.
          </div>
          <button className="btn btn-block" onClick={onTrocarNumero}>
            Tentar outro número
          </button>
          <a href={BOOKING_URL} style={{ display: 'block', marginTop: 14, fontSize: 12.5, fontWeight: 700, color: 'var(--text-link)' }}>
            Ainda não é cliente? Agende seu primeiro horário →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-bg">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>Digite o código</div>
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '6px 0 22px' }}>
          Enviamos 6 dígitos por SMS para <strong>{telefone}</strong>.<br />
          <button
            onClick={onTrocarNumero}
            style={{ border: 'none', background: 'none', color: 'var(--text-link)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', padding: 0 }}
          >
            Trocar número
          </button>
        </div>
        <div style={{ display: 'flex', gap: 7, justifyContent: 'center', marginBottom: 12 }}>
          {digitos.map((d, i) => (
            <input
              key={i}
              ref={(el) => (refs.current[i] = el)}
              className={`otp-box ${erro ? 'error' : d ? 'filled' : ''}`}
              value={d}
              inputMode="numeric"
              autoFocus={i === 0}
              disabled={enviando}
              onChange={(e) => setDigito(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
            />
          ))}
        </div>
        {erro && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--state-danger)', marginBottom: 10 }}>{erro}</div>}
        {codigoDemo && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            modo demo — seu código é <strong style={{ color: 'var(--text-primary)' }}>{codigoDemo}</strong>
          </div>
        )}
        {contagem > 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reenviar código em 0:{String(contagem).padStart(2, '0')}</div>
        ) : (
          <button
            className="btn btn-ghost"
            onClick={async () => {
              await onReenviar();
              setContagem(30);
              setDigitos(Array(N).fill(''));
              setErro(null);
              refs.current[0]?.focus();
            }}
          >
            Reenviar código
          </button>
        )}
      </div>
    </div>
  );
}
