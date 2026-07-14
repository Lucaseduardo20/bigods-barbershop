import { useState } from 'react';
import type { ParametrosDTO, ServicoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api, limparSessao } from '../lib/api';
import { dinheiro } from '../lib/format';
import { Badge, Dialog, ErroEstado, Loading, useApi, Vazio } from '../components/ui';

export function Ajustes({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  return (
    <div className="px-5">
      <h1 className="m-0 mb-4 text-[26px] font-bold leading-tight">Ajustes</h1>
      <div className="card mb-4 flex items-center justify-between">
        <div>
          <div className="font-bold text-[15px]">{usuario.nome}</div>
          <div className="flex gap-1.5 mt-1">
            {usuario.papeis.map((p) => (
              <Badge key={p} tone={p === Papel.ADMIN ? 'gold' : 'neutral'}>
                {p}
              </Badge>
            ))}
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            limparSessao();
            window.location.reload();
          }}
        >
          Sair
        </button>
      </div>
      {ehAdmin ? (
        <>
          <Servicos />
          <Parametros />
        </>
      ) : (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Configurações de serviços e parâmetros são restritas ao admin.
        </div>
      )}
    </div>
  );
}

function Servicos() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const [novoAberto, setNovoAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [duracao, setDuracao] = useState('30');
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const criar = async () => {
    setErroSalvar(null);
    try {
      await api('/servicos', {
        method: 'POST',
        body: {
          nome,
          precoAvulsoCentavos: Math.round(parseFloat(preco.replace(',', '.')) * 100),
          duracaoMinutos: parseInt(duracao, 10),
        },
      });
      setNovoAberto(false);
      setNome('');
      setPreco('');
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    }
  };

  const alternarAtivo = async (s: ServicoDTO) => {
    await api(`/servicos/${s.id}`, { method: 'PATCH', body: { ativo: !s.ativo } });
    recarregar();
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="label m-0">Serviços</div>
        <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
          + Novo
        </button>
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && <Vazio texto="Nenhum serviço cadastrado." />}
      <div className="flex flex-col gap-2">
        {(dados ?? []).map((s) => (
          <div key={s.id} className="card flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold">{s.nome}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {dinheiro(s.precoAvulsoCentavos)} · {s.duracaoMinutos} min
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={s.ativo ? 'success' : 'neutral'}>{s.ativo ? 'Ativo' : 'Inativo'}</Badge>
              <button className="btn btn-ghost btn-sm" onClick={() => alternarAtivo(s)}>
                {s.ativo ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={novoAberto} onClose={() => setNovoAberto(false)} title="Novo serviço">
        <div className="flex flex-col gap-3">
          <input className="input" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className="input" placeholder="Preço (R$)" value={preco} onChange={(e) => setPreco(e.target.value)} />
          <input
            className="input"
            type="number"
            placeholder="Duração (min)"
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
          />
          {erroSalvar && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erroSalvar}</div>}
          <button className="btn" disabled={!nome || !preco || !duracao} onClick={criar}>
            Salvar serviço
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function Parametros() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ParametrosDTO>('/parametros'), []);
  const [prazo, setPrazo] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const salvar = async () => {
    setErroSalvar(null);
    try {
      await api('/parametros', {
        method: 'PATCH',
        body: { prazoReagendamentoDias: parseInt(prazo!, 10) },
      });
      setPrazo(null);
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    }
  };

  return (
    <div>
      <div className="label">Parâmetros</div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {dados && (
        <div className="card">
          <div className="text-[14px] font-semibold mb-1.5">Prazo de reagendamento (2ª chance)</div>
          <div className="flex gap-2">
            <input
              className="input"
              type="number"
              value={prazo ?? String(dados.prazoReagendamentoDias)}
              onChange={(e) => setPrazo(e.target.value)}
            />
            <button className="btn btn-sm" disabled={prazo === null} onClick={salvar}>
              Salvar
            </button>
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
            Dias que o cliente tem para reagendar após uma falta.
          </div>
          {erroSalvar && (
            <div className="text-[13px] mt-1" style={{ color: 'var(--status-danger)' }}>
              {erroSalvar}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
