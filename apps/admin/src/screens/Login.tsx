import { useState } from 'react';
import type { LoginResponse } from '@bigods/contracts';
import { api, salvarSessao } from '../lib/api';

export function Login({ aoEntrar }: { aoEntrar: () => void }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const entrar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      const sessao = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { login, senha },
      });
      salvarSessao(sessao);
      aoEntrar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div
      className="min-h-dvh flex items-center justify-center px-6"
      style={{ background: 'var(--brand-ink)' }}
    >
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="brand-wordmark text-[34px]" style={{ color: 'var(--brand-cream)' }}>
            Bigod's Barber
          </div>
          <div className="text-[13px] mt-1" style={{ color: 'var(--brand-beige)' }}>
            Painel de gestão
          </div>
        </div>
        <div className="card flex flex-col gap-3">
          <input
            className="input"
            placeholder="Login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          <input
            className="input"
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && entrar()}
          />
          {erro && (
            <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
              {erro}
            </div>
          )}
          <button className="btn" disabled={ocupado || !login || !senha} onClick={entrar}>
            {ocupado ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </div>
    </div>
  );
}
