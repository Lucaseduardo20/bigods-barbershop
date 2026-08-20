import { useEffect, useState } from 'react';
import type { ConfiguracaoDeOrderBumpDTO, UsuarioDTO } from '@bigods/contracts';
import { MAX_MENSAGEM_BUMP, Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dinheiro } from '../lib/format';
import { CurrencyInput, Dialog, Tabs, useApi } from '../components/ui';
import { CabecalhoDeCatalogo, EstadoDaLista, ItemDeCatalogo, type AcaoDeItem } from '../components/crud';

type Aba = 'bump';

/**
 * "Funil de Vendas" (sessão 2026-08-17) — a casa da gestão do que é
 * MERCHANDISING do funil público, separado do cadastro em si (Catálogo).
 *
 * Parte 1 criou a seção com o liga/desliga do order-bump; a Parte 2 encheu de
 * conteúdo: preço promocional, chamada e ordem por item.
 */
export function FunilDeVendas({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [aba, setAba] = useState<Aba>('bump');

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">Funil de Vendas</h1>
      {!ehAdmin ? (
        <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          Configuração do funil é restrita ao admin.
        </div>
      ) : (
        <>
          <Tabs value={aba} onChange={setAba} tabs={[{ value: 'bump', label: 'Order-bump' }]} />
          <div className="mt-3">{aba === 'bump' && <ConfiguracaoDeOrderBump />}</div>
        </>
      )}
    </div>
  );
}

/** Percentual derivado do par (normal, promocional) — nunca o contrário. */
function percentual(normal: number, promocional: number | null): number {
  if (promocional === null || normal <= 0) return 0;
  return Math.round(((normal - promocional) / normal) * 1000) / 10;
}

/**
 * Vitrine do order-bump: quais serviços complementares e produtos são
 * oferecidos na confirmação do funil, e com que oferta. Lista geral, sem
 * segmentação nem motor de regras condicionais (decisão do dono —
 * DECISOES_PENDENTES #32).
 */
function ConfiguracaoDeOrderBump() {
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<ConfiguracaoDeOrderBumpDTO[]>('/order-bump/configuracao'),
    [],
  );
  const [editando, setEditando] = useState<ConfiguracaoDeOrderBumpDTO | null>(null);

  const alternar = async (item: ConfiguracaoDeOrderBumpDTO) => {
    await api(`/order-bump/${item.tipo}/${item.id}`, {
      method: 'PUT',
      body: {
        ativo: !item.ativoNoBump,
        precoPromocionalCentavos: item.precoPromocionalCentavos,
        mensagem: item.mensagem,
        ordem: item.ordem,
      },
    });
    recarregar();
  };

  const itens = dados ?? [];
  const noBump = itens.filter((i) => i.ativoNoBump);
  const comOferta = noBump.filter((i) => i.precoPromocionalCentavos !== null);

  const acoes = (item: ConfiguracaoDeOrderBumpDTO): AcaoDeItem[] => [
    { label: item.ativoNoBump ? 'Editar oferta' : 'Configurar oferta', onClick: () => setEditando(item) },
    item.ativoNoBump
      ? { label: 'Tirar do order-bump', onClick: () => void alternar(item), perigo: true }
      : { label: 'Oferecer no order-bump', onClick: () => void alternar(item) },
  ];

  const linha = (item: ConfiguracaoDeOrderBumpDTO) => {
    const pct = percentual(item.precoNormalCentavos, item.precoPromocionalCentavos);
    return (
      <ItemDeCatalogo
        key={`${item.tipo}:${item.id}`}
        titulo={item.nome}
        subtitulo={
          item.precoPromocionalCentavos !== null ? (
            <>
              <span style={{ textDecoration: 'line-through' }}>{dinheiro(item.precoNormalCentavos)}</span>{' '}
              <strong style={{ color: 'var(--brand-gold-700)' }}>
                {dinheiro(item.precoPromocionalCentavos)}
              </strong>
              {pct > 0 && <> · −{pct}%</>}
            </>
          ) : (
            <>{dinheiro(item.precoNormalCentavos)} · sem oferta</>
          )
        }
        badges={[
          ...(item.ativoNoBump ? [{ tone: 'gold', texto: 'No funil' }] : []),
          { tone: 'neutral', texto: item.tipo === 'SERVICO' ? 'Serviço' : 'Produto' },
        ]}
        acoes={acoes(item)}
      >
        {item.mensagem && (
          <div className="text-[12px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
            “{item.mensagem}”
          </div>
        )}
      </ItemDeCatalogo>
    );
  };

  return (
    <div className="mb-5">
      <CabecalhoDeCatalogo
        descricao={
          <>
            O que aparece em "Adicione à sua visita", na confirmação do agendamento. Mesma vitrine
            para todo cliente — o funil só esconde o que ele já tem no carrinho e o que o barbeiro
            escolhido não atende. Item com preço promocional aparece como oferta (preço normal
            riscado) e paga esse valor cravado, sem somar o desconto progressivo.
          </>
        }
        carregando={carregando}
        aoAtualizar={recarregar}
      />

      <div className="card mb-3" style={{ background: 'var(--surface-sunken)', borderStyle: 'dashed' }}>
        <div className="text-[13px]">
          <strong>{noBump.length}</strong> {noBump.length === 1 ? 'item oferecido' : 'itens oferecidos'} no
          fechamento do pedido
          {comOferta.length > 0 && <> · {comOferta.length} com preço promocional</>}.
        </div>
      </div>

      <EstadoDaLista
        carregando={carregando}
        erro={erro}
        vazio={itens.length === 0}
        textoVazio="Nada no catálogo para oferecer ainda."
        aoTentar={recarregar}
      />

      {noBump.length > 0 && (
        <>
          <div className="label mt-1">No funil</div>
          <div className="flex flex-col gap-2 mb-4">{noBump.map(linha)}</div>
        </>
      )}
      {itens.length > noBump.length && (
        <>
          <div className="label">Disponíveis para oferecer</div>
          <div className="flex flex-col gap-2">{itens.filter((i) => !i.ativoNoBump).map(linha)}</div>
        </>
      )}

      <OfertaDialog
        item={editando}
        aoFechar={() => setEditando(null)}
        aoSalvar={() => {
          setEditando(null);
          recarregar();
        }}
      />
    </div>
  );
}

/**
 * Duas formas de entrada (R$ final ou % de desconto), UMA fonte de verdade: o
 * que se envia e persiste é sempre o preço final em centavos. Se o percentual
 * fosse persistido, mudar o preço de catálogo amanhã moveria a oferta sozinha
 * — mesma disciplina do preço de PacoteOferta (DOMAIN.md §3.11).
 */
function OfertaDialog({
  item,
  aoFechar,
  aoSalvar,
}: {
  item: ConfiguracaoDeOrderBumpDTO | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [modo, setModo] = useState<'preco' | 'percentual'>('preco');
  const [comOferta, setComOferta] = useState(false);
  const [precoCentavos, setPrecoCentavos] = useState(0);
  const [percentualTexto, setPercentualTexto] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [ordem, setOrdem] = useState('0');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setErro(null);
    setModo('preco');
    setComOferta(item.precoPromocionalCentavos !== null);
    setPrecoCentavos(item.precoPromocionalCentavos ?? item.precoNormalCentavos);
    setPercentualTexto(String(percentual(item.precoNormalCentavos, item.precoPromocionalCentavos) || ''));
    setMensagem(item.mensagem ?? '');
    setOrdem(String(item.ordem));
  }, [item]);

  if (!item) return null;

  // No modo percentual, o preço final é DERIVADO na hora de salvar — é ele que
  // vai para a API, nunca o percentual.
  const pct = Number(percentualTexto.replace(',', '.'));
  const precoDoPercentual =
    Number.isFinite(pct) && pct > 0 && pct < 100
      ? Math.round(item.precoNormalCentavos * (1 - pct / 100))
      : null;
  const precoFinal = !comOferta ? null : modo === 'preco' ? precoCentavos : precoDoPercentual;
  const invalido =
    comOferta && (precoFinal === null || precoFinal <= 0 || precoFinal > item.precoNormalCentavos);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      await api(`/order-bump/${item.tipo}/${item.id}`, {
        method: 'PUT',
        body: {
          ativo: true,
          precoPromocionalCentavos: precoFinal,
          mensagem: mensagem.trim() || null,
          ordem: parseInt(ordem, 10) || 0,
        },
      });
      aoSalvar();
    } catch (e) {
      setErro(String((e as Error).message));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open onClose={aoFechar} title={`Oferta: ${item.nome}`}>
      <div className="flex flex-col gap-3">
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Preço normal: <strong>{dinheiro(item.precoNormalCentavos)}</strong>
          {item.tipo === 'SERVICO' && ' (referência da casa — o cliente vê o preço do barbeiro dele)'}
        </div>

        <label className="flex items-center gap-2 text-[14px] font-semibold">
          <input type="checkbox" checked={comOferta} onChange={(e) => setComOferta(e.target.checked)} />
          Oferecer com desconto
        </label>

        {comOferta && (
          <>
            <Tabs
              value={modo}
              onChange={setModo}
              tabs={[
                { value: 'preco', label: 'Preço promocional' },
                { value: 'percentual', label: '% de desconto' },
              ]}
            />
            {modo === 'preco' ? (
              <div>
                <label className="label">Preço no bump</label>
                <CurrencyInput centavos={precoCentavos} onChange={setPrecoCentavos} />
              </div>
            ) : (
              <div>
                <label className="label">Desconto (%)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={percentualTexto}
                  onChange={(e) => setPercentualTexto(e.target.value)}
                  placeholder="ex.: 30"
                />
                {precoDoPercentual !== null && (
                  <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Sai por <strong>{dinheiro(precoDoPercentual)}</strong> — é este valor que fica salvo.
                  </div>
                )}
              </div>
            )}
            {invalido && (
              <div className="text-[12px]" style={{ color: 'var(--status-danger)' }}>
                O preço da oferta precisa ser maior que zero e não pode passar de{' '}
                {dinheiro(item.precoNormalCentavos)} — senão seria acréscimo, não oferta.
              </div>
            )}
          </>
        )}

        <div>
          <label className="label">Chamada (opcional)</label>
          <input
            className="input"
            maxLength={MAX_MENSAGEM_BUMP}
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            placeholder="Leve pra casa por só…"
          />
        </div>

        <div>
          <label className="label">Ordem na vitrine</label>
          <input className="input" type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} />
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Menor aparece primeiro. Empate desempata pelo nome.
          </div>
        </div>

        {erro && <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>{erro}</div>}
        <button className="btn" disabled={salvando || invalido} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar e oferecer no funil'}
        </button>
      </div>
    </Dialog>
  );
}
