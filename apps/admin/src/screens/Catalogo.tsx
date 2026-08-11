import { useState } from 'react';
import type { ProdutoDTO, ServicoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dinheiro } from '../lib/format';
import { Badge, CurrencyInput, Dialog, ErroEstado, Loading, Tabs, useApi, Vazio } from '../components/ui';

type Aba = 'servicos' | 'produtos';

/**
 * PARTE 2 (sessão-D) — reorganização pura. "O que a barbearia oferece e por
 * quanto, no geral" (preço de REFERÊNCIA da casa) — antes vivia dentro de
 * Ajustes; nenhuma lógica/endpoint mudou, só o agrupamento visual.
 */
export function Catalogo({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [aba, setAba] = useState<Aba>('servicos');

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">Catálogo</h1>
      {!ehAdmin ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Catálogo de serviços e produtos é restrito ao admin.
        </div>
      ) : (
        <>
          <Tabs
            value={aba}
            onChange={setAba}
            tabs={[
              { value: 'servicos', label: 'Serviços' },
              { value: 'produtos', label: 'Produtos' },
            ]}
          />
          <div className="mt-3">
            {aba === 'servicos' && <Servicos />}
            {aba === 'produtos' && <Produtos />}
          </div>
        </>
      )}
    </div>
  );
}

function Servicos() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const [novoAberto, setNovoAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [duracao, setDuracao] = useState('30');
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [editandoPrecoId, setEditandoPrecoId] = useState<string | null>(null);
  const [precoEditado, setPrecoEditado] = useState(0);
  const [salvandoPreco, setSalvandoPreco] = useState(false);

  const criar = async () => {
    setErroSalvar(null);
    try {
      await api('/servicos', {
        method: 'POST',
        body: { nome, precoAvulsoCentavos: precoCentavos, duracaoMinutos: parseInt(duracao, 10) },
      });
      setNovoAberto(false);
      setNome('');
      setPrecoCentavos(0);
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    }
  };

  const alternarAtivo = async (s: ServicoDTO) => {
    await api(`/servicos/${s.id}`, { method: 'PATCH', body: { ativo: !s.ativo } });
    recarregar();
  };

  const salvarPreco = async (id: string) => {
    setSalvandoPreco(true);
    try {
      await api(`/servicos/${id}`, { method: 'PATCH', body: { precoAvulsoCentavos: precoEditado } });
      setEditandoPrecoId(null);
      recarregar();
    } finally {
      setSalvandoPreco(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="label m-0">Serviços</div>
        <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
          + Novo
        </button>
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Preço de referência da casa — cada barbeiro pode ter um override próprio (aba Barbeiros).
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && <Vazio texto="Nenhum serviço cadastrado." />}
      <div className="flex flex-col gap-2">
        {(dados ?? []).map((s) => (
          <div key={s.id} className="card flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-bold">{s.nome}</div>
              {editandoPrecoId === s.id ? (
                <div className="flex items-center gap-2 mt-1">
                  <CurrencyInput centavos={precoEditado} onChange={setPrecoEditado} style={{ width: 110 }} />
                  <button className="btn btn-sm" disabled={salvandoPreco || precoEditado <= 0} onClick={() => salvarPreco(s.id)}>
                    Salvar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditandoPrecoId(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {dinheiro(s.precoAvulsoCentavos)} · {s.duracaoMinutos} min
                </div>
              )}
            </div>
            {editandoPrecoId !== s.id && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge tone={s.ativo ? 'success' : 'neutral'}>{s.ativo ? 'Ativo' : 'Inativo'}</Badge>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditandoPrecoId(s.id);
                    setPrecoEditado(s.precoAvulsoCentavos);
                  }}
                >
                  Editar preço
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => alternarAtivo(s)}>
                  {s.ativo ? 'Desativar' : 'Reativar'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <Dialog open={novoAberto} onClose={() => setNovoAberto(false)} title="Novo serviço">
        <div className="flex flex-col gap-3">
          <input className="input" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} placeholder="Preço (R$)" />
          <input
            className="input"
            type="number"
            placeholder="Duração (min)"
            value={duracao}
            onChange={(e) => setDuracao(e.target.value)}
          />
          {erroSalvar && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erroSalvar}</div>}
          <button className="btn" disabled={!nome || precoCentavos <= 0 || !duracao} onClick={criar}>
            Salvar serviço
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function Produtos() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ProdutoDTO[]>('/produtos'), []);
  const [novoAberto, setNovoAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const criar = async () => {
    setErroSalvar(null);
    try {
      await api('/produtos', { method: 'POST', body: { nome, precoCentavos } });
      setNovoAberto(false);
      setNome('');
      setPrecoCentavos(0);
      recarregar();
    } catch (e) {
      setErroSalvar(String((e as Error).message));
    }
  };

  const alternarAtivo = async (p: ProdutoDTO) => {
    await api(`/produtos/${p.id}`, { method: 'PATCH', body: { ativo: !p.ativo } });
    recarregar();
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <div className="label m-0">Produtos</div>
        <button className="btn btn-sm" onClick={() => setNovoAberto(true)}>
          + Novo
        </button>
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
        Venda mínima, sem controle de estoque — só nome, preço e ativo/inativo.
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {!carregando && !erro && (dados ?? []).length === 0 && <Vazio texto="Nenhum produto cadastrado." />}
      <div className="flex flex-col gap-2">
        {(dados ?? []).map((p) => (
          <div key={p.id} className="card flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold">{p.nome}</div>
              <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                {dinheiro(p.precoCentavos)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={p.ativo ? 'success' : 'neutral'}>{p.ativo ? 'Ativo' : 'Inativo'}</Badge>
              <button className="btn btn-ghost btn-sm" onClick={() => alternarAtivo(p)}>
                {p.ativo ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={novoAberto} onClose={() => setNovoAberto(false)} title="Novo produto">
        <div className="flex flex-col gap-3">
          <input className="input" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} placeholder="Preço (R$)" />
          {erroSalvar && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erroSalvar}</div>}
          <button className="btn" disabled={!nome || precoCentavos <= 0} onClick={criar}>
            Salvar produto
          </button>
        </div>
      </Dialog>
    </div>
  );
}
