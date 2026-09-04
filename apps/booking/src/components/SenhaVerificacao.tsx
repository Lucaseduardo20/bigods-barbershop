import { useState } from 'react';
import type { ConfirmarLoginClienteResponse } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { COMPANY_ID } from '../lib/config';
import { AlertaErro } from './ui';
import { BARBEARIA } from '../lib/barbearia';
import { IconeDeMarca } from './IconesDeMarca';

/**
 * ★★ "Entre com sua senha" no funil (2026-09-04).
 *
 * Ocupa, na contingência, o lugar exato do `OtpVerificacao` com motivo
 * `identificar`: o telefone digitado JÁ tem cadastro, e antes de mostrar (ou
 * usar) o nome de alguém essa pessoa prova que a conta é dela. O que muda é a
 * prova — senha em vez de código, porque o código não chega.
 *
 * Só aparece para quem TEM senha. Quem tem conta e não tem senha nunca chega
 * aqui: aquele caso não pode virar "crie uma agora" (seria entregar a conta a
 * quem digitou o número primeiro) e é resolvido pela barbearia, à mão.
 *
 * A saída para o WhatsApp fica sempre visível, no mesmo lugar e pelo mesmo
 * motivo do modal de código: quem não lembra a senha está travado, e é aí que
 * mais precisa de um humano.
 */
export function SenhaVerificacao({
  telefone,
  onVerificado,
  onSeguirSemEntrar,
  onCancelar,
}: {
  telefone: string;
  onVerificado: (sessao: ConfirmarLoginClienteResponse) => void;
  /**
   * Esqueceu a senha e ainda assim quer o horário. O funil segue SEM saber quem
   * é: não mostra o nome do cadastro e não pergunta um novo, e o agendamento
   * nasce pendente como todos os da contingência. Fechar a porta aqui deixaria
   * um cliente antigo sem conseguir marcar — que é o desfecho que a
   * contingência inteira existe para evitar.
   */
  onSeguirSemEntrar: () => void;
  onCancelar: () => void;
}) {
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const entrar = async () => {
    if (!senha || ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<ConfirmarLoginClienteResponse>('/conta/login/senha', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone, senha },
      });
      onVerificado(r);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
      setSenha('');
    } finally {
      setOcupado(false);
    }
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
              <div className="text-[18px] font-extrabold leading-tight">Confirme que é você</div>
              <div className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
                Leva só alguns segundos
              </div>
            </div>
          </div>
          <button className="icon-btn" style={{ fontSize: 20 }} aria-label="Fechar" onClick={onCancelar}>
            ×
          </button>
        </div>

        <div className="text-[13.5px] mb-4" style={{ color: 'var(--text-secondary)' }}>
          Este número já tem conta na barbearia. Digite sua senha para seguirmos com os seus dados.
        </div>

        <label className="label">Senha</label>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={senha}
          disabled={ocupado}
          onChange={(e) => {
            setSenha(e.target.value);
            setErro(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void entrar()}
        />

        {erro && (
          <div className="mt-3">
            <AlertaErro texto={erro} />
          </div>
        )}

        <button
          className="btn btn-block mt-4"
          disabled={ocupado || senha.length === 0}
          onClick={() => void entrar()}
        >
          {ocupado ? 'Entrando…' : 'Entrar'}
        </button>

        <button
          className="btn-ghost btn-block mt-2"
          style={{ fontSize: 13 }}
          onClick={onSeguirSemEntrar}
        >
          Continuar sem entrar
        </button>
        <div className="text-[12px] text-center mt-1.5" style={{ color: 'var(--text-muted)' }}>
          Você ainda consegue marcar seu horário — a barbearia confirma com você depois.
        </div>

        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="text-[12.5px] text-center" style={{ color: 'var(--text-muted)' }}>
            Esqueceu a senha? Fale com a barbearia que a gente resolve na hora.
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
