import { useEffect, useRef, useState } from 'react';
import { validarSenhaDeCliente } from '@bigods/contracts';
import { ApiError } from '../lib/api';
import { BOOKING_URL } from '../lib/config';
import { mascararTelefone, telefoneValido } from '../lib/telefone';
import { Icon, Spinner } from '../components/ui';

/**
 * ★★ AS TRÊS PORTAS DA CONTA DO CLIENTE (2026-08-28).
 *
 * Nasceram de um incidente: o provedor de SMS não entrega mais que ~2 códigos
 * por número em curto período, e o login era 100% código — quem precisava de um
 * segundo no mesmo dia ficava trancado para fora da própria conta.
 *
 * Agora são três caminhos com textos DELIBERADAMENTE diferentes, porque são
 * três coisas diferentes e o cliente precisa saber qual está fazendo:
 *
 *   1. confirmar o agendamento (código) — vive no funil, não aqui;
 *   2. `DefinirSenha`   — primeiro acesso, logo depois de agendar. SEM código:
 *      o telefone acabou de ser verificado ali;
 *   3. `RecuperarSenha` — esqueci a senha (ou nunca tive). É o ÚNICO lugar
 *      desta tela que ainda gasta um SMS.
 *
 * O login de todo dia (`Login`) não manda código nenhum.
 */

/* ---------------- 1. Entrar: telefone + senha ---------------- */
export function Login({
  onEntrar,
  onEsqueci,
}: {
  onEntrar: (telefone: string, senha: string) => Promise<void>;
  onEsqueci: (telefone: string) => void;
}) {
  const [telefone, setTelefone] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ok = telefoneValido(telefone) && senha.length > 0;

  const entrar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await onEntrar(telefone, senha);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <Marca />
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
        <CampoDeSenha
          valor={senha}
          onChange={setSenha}
          autoComplete="current-password"
          onEnter={() => ok && !enviando && entrar()}
        />

        {erro && (
          <div style={{ fontSize: 13, color: 'var(--state-danger)', marginTop: 10, fontWeight: 600 }}>{erro}</div>
        )}

        <button className="btn btn-block btn-lg" style={{ marginTop: 16 }} disabled={!ok || enviando} onClick={entrar}>
          {enviando ? <Spinner /> : 'Entrar'}
        </button>

        {/* Uma porta só para "esqueci" e "nunca tive": são o mesmo caminho
            (confirmar o telefone e escolher uma senha), e oferecer dois links
            que levam ao mesmo lugar só faria o cliente escolher errado. */}
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 10 }}
          onClick={() => onEsqueci(telefone)}
        >
          Esqueci minha senha / ainda não tenho
        </button>

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

/* ---------------- 2. Primeiro acesso: escolher a senha ---------------- */
/**
 * Sem código: quem chega aqui acabou de confirmar o telefone no agendamento e
 * veio pela ponte do funil. O texto diz exatamente isso, para o cliente não
 * ficar esperando um SMS que não vem.
 */
export function DefinirSenha({
  telefone,
  onSalvar,
  onDepois,
}: {
  telefone: string;
  onSalvar: (senha: string) => Promise<void>;
  onDepois: () => void;
}) {
  return (
    <div className="auth-bg">
      <div className="auth-card">
        <Marca />
        <div style={{ fontSize: 19, fontWeight: 800, textAlign: 'center', marginTop: 10 }}>
          Crie sua senha
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center', margin: '6px 0 18px' }}>
          Seu telefone <strong>{telefone}</strong> já está confirmado. Escolha uma senha para entrar
          direto das próximas vezes, sem esperar SMS.
        </div>
        <FormularioDeSenha telefone={telefone} rotulo="Salvar senha e continuar" onSalvar={onSalvar} />
        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onDepois}>
          Agora não
        </button>
      </div>
    </div>
  );
}

/* ---------------- 3. Esqueci a senha: código + senha nova ---------------- */
type FaseRecuperacao = 'telefone' | 'codigo' | 'senha';

export function RecuperarSenha({
  telefoneInicial,
  onIniciar,
  onConfirmar,
  onVoltar,
}: {
  telefoneInicial: string;
  /** Dispara o SMS. Devolve o código do modo demo, quando houver. */
  onIniciar: (telefone: string) => Promise<{ codigoDemo: string | null }>;
  /** Confere o código E grava a senha nova, num passo só no servidor. */
  onConfirmar: (codigo: string, senha: string) => Promise<void>;
  onVoltar: () => void;
}) {
  const [fase, setFase] = useState<FaseRecuperacao>('telefone');
  const [telefone, setTelefone] = useState(telefoneInicial);
  const [codigo, setCodigo] = useState('');
  const [codigoDemo, setCodigoDemo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviarCodigo = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const r = await onIniciar(telefone);
      setCodigoDemo(r.codigoDemo);
      setFase('codigo');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <Marca />
        <div style={{ fontSize: 19, fontWeight: 800, textAlign: 'center', marginTop: 10 }}>
          Recuperar acesso
        </div>

        {fase === 'telefone' && (
          <>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center', margin: '6px 0 18px' }}>
              Vamos mandar um código por SMS para confirmar que o telefone é seu. Depois você escolhe
              uma senha nova.
            </div>
            <label className="label">Telefone</label>
            <input
              className="input"
              inputMode="tel"
              placeholder="(11) 99999-9999"
              value={telefone}
              onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
              onKeyDown={(e) => e.key === 'Enter' && telefoneValido(telefone) && !enviando && enviarCodigo()}
            />
            {erro && <div style={{ fontSize: 13, color: 'var(--state-danger)', marginTop: 10, fontWeight: 600 }}>{erro}</div>}
            <button
              className="btn btn-block btn-lg"
              style={{ marginTop: 16 }}
              disabled={!telefoneValido(telefone) || enviando}
              onClick={enviarCodigo}
            >
              {enviando ? <Spinner /> : 'Receber código por SMS'}
            </button>
          </>
        )}

        {fase === 'codigo' && (
          <>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center', margin: '6px 0 18px' }}>
              Enviamos 6 dígitos para <strong>{telefone}</strong>.
            </div>
            <CaixasDeCodigo
              erro={!!erro}
              onCompleto={(valor) => {
                setCodigo(valor);
                setErro(null);
                setFase('senha');
              }}
            />
            {codigoDemo && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10 }}>
                modo demo — seu código é <strong style={{ color: 'var(--text-primary)' }}>{codigoDemo}</strong>
              </div>
            )}
            <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={() => setFase('telefone')}>
              Não recebi / trocar número
            </button>
          </>
        )}

        {fase === 'senha' && (
          <>
            <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center', margin: '6px 0 18px' }}>
              Código conferido. Agora escolha sua nova senha.
            </div>
            <FormularioDeSenha
              telefone={telefone}
              rotulo="Salvar nova senha"
              onSalvar={async (senha) => {
                try {
                  await onConfirmar(codigo, senha);
                } catch (e) {
                  // Código errado/expirado só aparece AQUI, no envio: é o
                  // servidor que confere. Volta o cliente para os dígitos.
                  setErro(e instanceof ApiError ? e.message : String(e));
                  setFase('codigo');
                  throw e;
                }
              }}
            />
          </>
        )}

        <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={onVoltar}>
          Voltar para o login
        </button>
      </div>
    </div>
  );
}

/* ---------------- peças comuns ---------------- */

function Marca() {
  return (
    <>
      <div className="auth-mark">
        <img src="/brand/symbol-dark.png" alt="Bigod's Barber" style={{ width: '70%', height: 'auto' }} />
      </div>
      <div className="brand-wordmark" style={{ textAlign: 'center', fontSize: 24, color: 'var(--text-primary)' }}>
        Bigod's Barber
      </div>
      <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)', marginTop: 2 }}>
        Área do cliente
      </div>
    </>
  );
}

/**
 * Senha + confirmação, com a MESMA regra que o servidor aplica
 * (`validarSenhaDeCliente`, de `packages/contracts`). O feedback é imediato,
 * mas quem manda continua sendo o back — aqui é conveniência, não segurança.
 */
function FormularioDeSenha({
  telefone,
  rotulo,
  onSalvar,
}: {
  telefone: string;
  rotulo: string;
  onSalvar: (senha: string) => Promise<void>;
}) {
  const [senha, setSenha] = useState('');
  const [repetida, setRepetida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const politica = validarSenhaDeCliente(senha, telefone);
  const iguais = senha.length > 0 && senha === repetida;
  const ok = politica.ok && iguais;

  const salvar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await onSalvar(senha);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
      setEnviando(false);
      return;
    }
    setEnviando(false);
  };

  return (
    <>
      <label className="label">Nova senha</label>
      <CampoDeSenha valor={senha} onChange={setSenha} autoComplete="new-password" />
      <label className="label" style={{ marginTop: 12 }}>Repita a senha</label>
      <CampoDeSenha
        valor={repetida}
        onChange={setRepetida}
        autoComplete="new-password"
        onEnter={() => ok && !enviando && salvar()}
      />

      {/* Só reclama do que o cliente já digitou: um aviso vermelho antes de ele
          escrever qualquer coisa é ruído, não ajuda. */}
      <div style={{ fontSize: 12.5, marginTop: 8, color: senha && !politica.ok ? 'var(--state-danger)' : 'var(--text-muted)' }}>
        {senha && !politica.ok ? politica.erro : 'Pelo menos 8 caracteres. Pode ser uma frase que você lembre.'}
      </div>
      {repetida && !iguais && (
        <div style={{ fontSize: 12.5, marginTop: 4, color: 'var(--state-danger)' }}>As senhas não são iguais.</div>
      )}
      {erro && <div style={{ fontSize: 13, color: 'var(--state-danger)', marginTop: 10, fontWeight: 600 }}>{erro}</div>}

      <button className="btn btn-block btn-lg" style={{ marginTop: 16 }} disabled={!ok || enviando} onClick={salvar}>
        {enviando ? <Spinner /> : rotulo}
      </button>
    </>
  );
}

function CampoDeSenha({
  valor,
  onChange,
  autoComplete,
  onEnter,
}: {
  valor: string;
  onChange: (v: string) => void;
  autoComplete: string;
  onEnter?: () => void;
}) {
  const [visivel, setVisivel] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        style={{ paddingRight: 64 }}
        type={visivel ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      {/* Mostrar a senha é acessibilidade real no celular: sem isso o cliente
          erra a digitação e não descobre onde. */}
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        style={{
          position: 'absolute',
          right: 10,
          top: '50%',
          transform: 'translateY(-50%)',
          border: 'none',
          background: 'none',
          color: 'var(--text-link)',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {visivel ? 'ocultar' : 'mostrar'}
      </button>
    </div>
  );
}

const N = 6;

/** As seis caixinhas do código — a mesma UI que o funil usa. */
function CaixasDeCodigo({ erro, onCompleto }: { erro: boolean; onCompleto: (codigo: string) => void }) {
  const [digitos, setDigitos] = useState<string[]>(Array(N).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (erro) {
      setDigitos(Array(N).fill(''));
      refs.current[0]?.focus();
    }
  }, [erro]);

  const setDigito = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    const next = [...digitos];
    next[i] = d;
    setDigitos(next);
    if (d && i < N - 1) refs.current[i + 1]?.focus();
    if (next.every((x) => x !== '')) onCompleto(next.join(''));
  };

  return (
    <div style={{ display: 'flex', gap: 7, justifyContent: 'center', marginBottom: 12 }}>
      {digitos.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className={`otp-box ${erro ? 'error' : d ? 'filled' : ''}`}
          value={d}
          inputMode="numeric"
          autoFocus={i === 0}
          onChange={(e) => setDigito(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digitos[i] && i > 0) refs.current[i - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/** Aviso persistente na home de quem ainda não tem senha (2026-08-28). */
export function AvisoSemSenha({ onDefinir }: { onDefinir: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: 12,
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-brand-tint)',
        border: '1px dashed var(--accent-primary)',
        marginBottom: 16,
      }}
    >
      <Icon name="ticket" size={16} />
      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)' }}>
        <strong style={{ color: 'var(--text-primary)' }}>Crie sua senha</strong> — assim você entra
        direto, sem esperar SMS.
      </div>
      <button className="btn btn-sm" onClick={onDefinir}>
        Criar
      </button>
    </div>
  );
}
