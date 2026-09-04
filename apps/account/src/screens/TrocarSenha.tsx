import { useState } from 'react';
import { validarSenhaDeCliente } from '@bigods/contracts';
import { api, ApiError } from '../lib/api';
import { Icon, Spinner } from '../components/ui';

/**
 * ★★ O CLIENTE TROCA A PRÓPRIA SENHA (2026-09-04).
 *
 * Existe porque a senha de boa parte dos clientes hoje foi definida pela
 * BARBEARIA e passada por WhatsApp — alguém de lá conhece a senha deles. Sem
 * esta tela, essa senha seria definitiva.
 *
 * Exige a senha ATUAL, mesmo com o cliente já logado. A sessão dura 30 dias e
 * vive num celular: um aparelho destravado esquecido no balcão não pode trocar
 * a senha e trancar o dono para fora da conta dele. É o mesmo padrão do
 * "alterar senha" do staff, e a regra vale nas duas pontas (aqui para avisar
 * enquanto digita, no backend porque é lá que ela protege).
 */
export function TrocarSenha({
  telefone,
  token,
  onVoltar,
}: {
  telefone: string;
  token: string;
  onVoltar: () => void;
}) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  const politica = validarSenhaDeCliente(novaSenha, telefone);
  const confere = confirmacao.length > 0 && novaSenha === confirmacao;
  const ok = senhaAtual.length > 0 && politica.ok && confere;

  const salvar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await api('/conta/senha', { method: 'PUT', token, body: { senhaAtual, novaSenha } });
      setPronto(true);
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmacao('');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : String(e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ padding: '18px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <button className="icon-btn" aria-label="Voltar" onClick={onVoltar}>
          <Icon name="arrow-left" size={18} />
        </button>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Minha senha</div>
      </div>

      {pronto ? (
        <div className="card">
          <div style={{ fontSize: 14, fontWeight: 700 }}>Senha alterada</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
            Da próxima vez, entre com seu telefone e a senha nova. Sua sessão neste aparelho
            continua valendo.
          </div>
          <button className="btn btn-block" style={{ marginTop: 14 }} onClick={onVoltar}>
            Voltar
          </button>
        </div>
      ) : (
        <div className="card">
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
            Se a barbearia criou uma senha para você, esta é a hora de fazer a sua.
          </div>

          <label className="label">Senha atual</label>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={senhaAtual}
            onChange={(e) => {
              setSenhaAtual(e.target.value);
              setErro(null);
            }}
          />

          <label className="label" style={{ marginTop: 12 }}>Nova senha</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="Pelo menos 8 caracteres"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
          />
          {novaSenha.length > 0 && !politica.ok && (
            <div style={{ fontSize: 12.5, color: 'var(--state-danger)', marginTop: 6, fontWeight: 600 }}>
              {politica.erro}
            </div>
          )}

          <label className="label" style={{ marginTop: 12 }}>Repita a nova senha</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ok && !enviando && void salvar()}
          />
          {confirmacao.length > 0 && !confere && (
            <div style={{ fontSize: 12.5, color: 'var(--state-danger)', marginTop: 6, fontWeight: 600 }}>
              As duas senhas não são iguais.
            </div>
          )}

          {erro && (
            <div style={{ fontSize: 13, color: 'var(--state-danger)', marginTop: 12, fontWeight: 600 }}>
              {erro}
            </div>
          )}

          <button
            className="btn btn-block"
            style={{ marginTop: 16 }}
            disabled={!ok || enviando}
            onClick={() => void salvar()}
          >
            {enviando ? <Spinner /> : 'Salvar nova senha'}
          </button>
        </div>
      )}
    </div>
  );
}
