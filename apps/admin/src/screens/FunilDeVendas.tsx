import { useState } from 'react';
import type { ProdutoDTO, ServicoDTO, UsuarioDTO } from '@bigods/contracts';
import { Papel } from '@bigods/contracts';
import { api } from '../lib/api';
import { dinheiro } from '../lib/format';
import { Tabs, useApi } from '../components/ui';
import { CabecalhoDeCatalogo, EstadoDaLista, ItemDeCatalogo, type AcaoDeItem } from '../components/crud';

type Aba = 'bump';

/**
 * "Funil de Vendas" (sessão 2026-08-17, Parte 1) — a casa da gestão do que é
 * MERCHANDISING do funil público, separado do cadastro em si (Catálogo).
 *
 * Nasce abrigando a configuração do ORDER-BUMP ("Adicione à sua visita",
 * DOMAIN.md §8.13), que antes vivia como um botão solto no meio do CRUD de
 * serviços/produtos — decidir "isto é oferecido no fechamento do pedido" é
 * decisão de venda, não de cadastro, e ficava invisível ali no meio.
 *
 * A seção existe como abas desde já porque é onde o resto do funil (regras,
 * mensagens, futuras vitrines) vai morar.
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

/**
 * Vitrine curada do order-bump: quais serviços complementares e produtos são
 * oferecidos na confirmação do funil. Lista geral, sem segmentação nem motor
 * de regras condicionais (decisão do dono — DECISOES_PENDENTES #32).
 */
function ConfiguracaoDeOrderBump() {
  const servicos = useApi(() => api<ServicoDTO[]>('/servicos'), []);
  const produtos = useApi(() => api<ProdutoDTO[]>('/produtos'), []);

  const recarregarTudo = () => {
    servicos.recarregar();
    produtos.recarregar();
  };

  const alternarServico = async (s: ServicoDTO) => {
    await api(`/servicos/${s.id}`, { method: 'PATCH', body: { sugeridoNoBump: !s.sugeridoNoBump } });
    servicos.recarregar();
  };

  const alternarProduto = async (p: ProdutoDTO) => {
    await api(`/produtos/${p.id}`, { method: 'PATCH', body: { sugeridoNoBump: !p.sugeridoNoBump } });
    produtos.recarregar();
  };

  const carregando = servicos.carregando || produtos.carregando;
  const erro = servicos.erro ?? produtos.erro;
  const listaServicos = (servicos.dados ?? []).filter((s) => s.ativo);
  const listaProdutos = (produtos.dados ?? []).filter((p) => p.ativo);
  const noBump =
    listaServicos.filter((s) => s.sugeridoNoBump).length + listaProdutos.filter((p) => p.sugeridoNoBump).length;

  const acoesServico = (s: ServicoDTO): AcaoDeItem[] => [
    s.sugeridoNoBump
      ? { label: 'Tirar do order-bump', onClick: () => void alternarServico(s), perigo: true }
      : { label: 'Oferecer no order-bump', onClick: () => void alternarServico(s) },
  ];

  const acoesProduto = (p: ProdutoDTO): AcaoDeItem[] => [
    p.sugeridoNoBump
      ? { label: 'Tirar do order-bump', onClick: () => void alternarProduto(p), perigo: true }
      : { label: 'Oferecer no order-bump', onClick: () => void alternarProduto(p) },
  ];

  return (
    <div className="mb-5">
      <CabecalhoDeCatalogo
        descricao={
          <>
            O que aparece em "Adicione à sua visita", na confirmação do agendamento. Mesma vitrine
            para todo cliente — o funil só esconde o que ele já colocou no carrinho e o que o
            barbeiro escolhido não atende. Itens inativos no Catálogo não aparecem aqui.
          </>
        }
        carregando={carregando}
        aoAtualizar={recarregarTudo}
      />

      <div
        className="card mb-3"
        style={{ background: 'var(--surface-sunken)', borderStyle: 'dashed' }}
      >
        <div className="text-[13px]">
          <strong>{noBump}</strong> {noBump === 1 ? 'item oferecido' : 'itens oferecidos'} no
          fechamento do pedido.
        </div>
      </div>

      <EstadoDaLista
        carregando={carregando}
        erro={erro}
        vazio={listaServicos.length === 0 && listaProdutos.length === 0}
        textoVazio="Nada no catálogo para oferecer ainda."
        aoTentar={recarregarTudo}
      />

      {listaServicos.length > 0 && (
        <>
          <div className="label mt-1">Serviços complementares</div>
          <div className="flex flex-col gap-2 mb-4">
            {listaServicos.map((s) => (
              <ItemDeCatalogo
                key={s.id}
                titulo={s.nome}
                subtitulo={`${dinheiro(s.precoAvulsoCentavos)} · ${s.duracaoMinutos} min`}
                badges={s.sugeridoNoBump ? [{ tone: 'gold', texto: 'No order-bump' }] : []}
                acoes={acoesServico(s)}
              />
            ))}
          </div>
        </>
      )}

      {listaProdutos.length > 0 && (
        <>
          <div className="label">Produtos</div>
          <div className="flex flex-col gap-2">
            {listaProdutos.map((p) => (
              <ItemDeCatalogo
                key={p.id}
                titulo={p.nome}
                subtitulo={dinheiro(p.precoCentavos)}
                badges={p.sugeridoNoBump ? [{ tone: 'gold', texto: 'No order-bump' }] : []}
                acoes={acoesProduto(p)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
