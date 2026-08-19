import { useEffect, useState } from 'react';
import type { ProdutoDTO, ServicoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dinheiro } from '../lib/format';
import { CurrencyInput, Dialog, Tabs, useApi } from '../components/ui';
import { CabecalhoDeCatalogo, EstadoDaLista, ItemDeCatalogo, type AcaoDeItem } from '../components/crud';
import { Foto, FotoUpload } from '../components/FotoUpload';

type Aba = 'servicos' | 'produtos';

/**
 * "O que a barbearia oferece e por quanto, no geral" (preço de REFERÊNCIA da
 * casa). Sessão 2026-08-17 (Parte 1): CRUD completo e padronizado — serviços e
 * produtos usam o MESMO componente de linha/menu de ações (`components/crud`),
 * e a configuração de order-bump saiu daqui para a seção "Funil de Vendas"
 * (era um botão solto no meio do catálogo, que é assunto de merchandising, não
 * de cadastro).
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
  const [editando, setEditando] = useState<ServicoDTO | null>(null);
  const [criando, setCriando] = useState(false);

  const alternarAtivo = async (s: ServicoDTO) => {
    await api(`/servicos/${s.id}`, { method: 'PATCH', body: { ativo: !s.ativo } });
    recarregar();
  };

  const acoes = (s: ServicoDTO): AcaoDeItem[] => [
    { label: 'Editar', onClick: () => setEditando(s) },
    // Soft-disable: nunca deleta — atendimento histórico referencia o serviço.
    s.ativo
      ? { label: 'Desativar', onClick: () => void alternarAtivo(s), perigo: true }
      : { label: 'Reativar', onClick: () => void alternarAtivo(s) },
  ];

  return (
    <div className="mb-5">
      <CabecalhoDeCatalogo
        descricao={
          <>
            Preço de referência da casa — cada barbeiro pode ter um override próprio (aba
            Usuários). Sugestão no funil agora se configura em <strong>Funil de Vendas</strong>.
          </>
        }
        carregando={carregando}
        aoAtualizar={recarregar}
        aoCriar={() => setCriando(true)}
        rotuloCriar="+ Novo serviço"
      />
      <EstadoDaLista
        carregando={carregando}
        erro={erro}
        vazio={(dados ?? []).length === 0}
        textoVazio="Nenhum serviço cadastrado."
        aoTentar={recarregar}
      />
      <div className="flex flex-col gap-2">
        {(dados ?? []).map((s) => (
          <ItemDeCatalogo
            key={s.id}
            titulo={s.nome}
            subtitulo={`${dinheiro(s.precoAvulsoCentavos)} · ${s.duracaoMinutos} min`}
            badges={[{ tone: s.ativo ? 'success' : 'neutral', texto: s.ativo ? 'Ativo' : 'Inativo' }]}
            acoes={acoes(s)}
          />
        ))}
      </div>
      <ServicoDialog
        aberto={criando || !!editando}
        editando={editando}
        aoFechar={() => {
          setCriando(false);
          setEditando(null);
        }}
        aoSalvar={() => {
          setCriando(false);
          setEditando(null);
          recarregar();
        }}
      />
    </div>
  );
}

/** Um diálogo só para criar E editar — os campos são os mesmos. */
function ServicoDialog({
  aberto,
  editando,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  editando: ServicoDTO | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState('');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [duracao, setDuracao] = useState('30');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setNome(editando?.nome ?? '');
    setPrecoCentavos(editando?.precoAvulsoCentavos ?? 0);
    setDuracao(String(editando?.duracaoMinutos ?? 30));
  }, [aberto, editando]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    const corpo = {
      nome: nome.trim(),
      precoAvulsoCentavos: precoCentavos,
      duracaoMinutos: parseInt(duracao, 10),
    };
    try {
      if (editando) {
        await api(`/servicos/${editando.id}`, { method: 'PATCH', body: corpo });
      } else {
        await api('/servicos', { method: 'POST', body: corpo });
      }
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  const minutos = parseInt(duracao, 10);
  const invalido = !nome.trim() || precoCentavos <= 0 || !Number.isFinite(minutos) || minutos <= 0;

  return (
    <Dialog open={aberto} onClose={aoFechar} title={editando ? `Editar ${editando.nome}` : 'Novo serviço'}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="label">Nome</label>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div>
          <label className="label">Preço de referência</label>
          <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} />
        </div>
        <div>
          <label className="label">Duração (min)</label>
          <input className="input" type="number" value={duracao} onChange={(e) => setDuracao(e.target.value)} />
          {editando && (
            <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Vale só para agendamentos novos — quem já tem horário marcado mantém o bloco reservado.
            </div>
          )}
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || invalido} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar serviço'}
        </button>
      </div>
    </Dialog>
  );
}

function Produtos() {
  const { dados, erro, carregando, recarregar } = useApi(() => api<ProdutoDTO[]>('/produtos'), []);
  const [editando, setEditando] = useState<ProdutoDTO | null>(null);
  const [criando, setCriando] = useState(false);

  const alternarAtivo = async (p: ProdutoDTO) => {
    await api(`/produtos/${p.id}`, { method: 'PATCH', body: { ativo: !p.ativo } });
    recarregar();
  };

  const acoes = (p: ProdutoDTO): AcaoDeItem[] => [
    { label: 'Editar', onClick: () => setEditando(p) },
    p.ativo
      ? { label: 'Desativar', onClick: () => void alternarAtivo(p), perigo: true }
      : { label: 'Reativar', onClick: () => void alternarAtivo(p) },
  ];

  return (
    <div className="mb-5">
      <CabecalhoDeCatalogo
        descricao={
          <>
            Venda mínima, sem controle de estoque — só nome, preço e ativo/inativo. Sugestão no
            funil se configura em <strong>Funil de Vendas</strong>.
          </>
        }
        carregando={carregando}
        aoAtualizar={recarregar}
        aoCriar={() => setCriando(true)}
        rotuloCriar="+ Novo produto"
      />
      <EstadoDaLista
        carregando={carregando}
        erro={erro}
        vazio={(dados ?? []).length === 0}
        textoVazio="Nenhum produto cadastrado."
        aoTentar={recarregar}
      />
      <div className="flex flex-col gap-2">
        {(dados ?? []).map((p) => (
          <ItemDeCatalogo
            key={p.id}
            titulo={p.nome}
            subtitulo={dinheiro(p.precoCentavos)}
            badges={[{ tone: p.ativo ? 'success' : 'neutral', texto: p.ativo ? 'Ativo' : 'Inativo' }]}
            acoes={acoes(p)}
            inicio={<Foto url={p.fotoUrl} nome={p.nome} size={38} redonda={false} fallback={<span aria-hidden="true">🧴</span>} />}
          />
        ))}
      </div>
      <ProdutoDialog
        aberto={criando || !!editando}
        editando={editando}
        aoAtualizarLista={recarregar}
        aoFechar={() => {
          setCriando(false);
          setEditando(null);
        }}
        aoSalvar={() => {
          setCriando(false);
          setEditando(null);
          recarregar();
        }}
      />
    </div>
  );
}

function ProdutoDialog({
  aberto,
  editando,
  aoFechar,
  aoSalvar,
  aoAtualizarLista,
}: {
  aberto: boolean;
  editando: ProdutoDTO | null;
  aoFechar: () => void;
  aoSalvar: () => void;
  /** A foto salva na hora (endpoint próprio) — a lista atrás do diálogo precisa saber. */
  aoAtualizarLista: () => void;
}) {
  const [nome, setNome] = useState('');
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setNome(editando?.nome ?? '');
    setPrecoCentavos(editando?.precoCentavos ?? 0);
    setFotoUrl(editando?.fotoUrl ?? null);
  }, [aberto, editando]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    const corpo = { nome: nome.trim(), precoCentavos };
    try {
      if (editando) {
        await api(`/produtos/${editando.id}`, { method: 'PATCH', body: corpo });
      } else {
        await api('/produtos', { method: 'POST', body: corpo });
      }
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={aberto} onClose={aoFechar} title={editando ? `Editar ${editando.nome}` : 'Novo produto'}>
      <div className="flex flex-col gap-3">
        {/* A foto só aparece ao EDITAR: o upload precisa de um id, e o produto
            só ganha id depois de salvo. Criar → salvar → reabrir para a foto é
            um passo a mais, mas é honesto — melhor que segurar bytes em
            memória esperando um id que pode nem vir. */}
        {editando && (
          <div>
            <label className="label">Foto</label>
            <FotoUpload
              rotaBase={`/produtos/${editando.id}`}
              urlAtual={fotoUrl}
              nome={editando.nome}
              redonda={false}
              tamanho={64}
              fallback={<span aria-hidden="true">🧴</span>}
              aoMudar={(url) => {
                setFotoUrl(url);
                aoAtualizarLista();
              }}
            />
          </div>
        )}
        <div>
          <label className="label">Nome</label>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div>
          <label className="label">Preço</label>
          <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} />
        </div>
        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || !nome.trim() || precoCentavos <= 0} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar produto'}
        </button>
      </div>
    </Dialog>
  );
}
