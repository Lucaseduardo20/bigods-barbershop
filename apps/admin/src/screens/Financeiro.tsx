import { useState } from 'react';
import type { BarbeiroDTO, ExtratoComissaoDTO, LancamentoComissaoDTO, UsuarioDTO } from '@bigods/contracts';
import { OrigemComissao, Papel, TipoLancamento } from '@bigods/contracts';
import { api } from '../lib/api';
import { dataCurta, dinheiro } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { Badge, BotaoAtualizar, ErroEstado, Loading, Tabs, useApi, Vazio } from '../components/ui';
import { AtendimentoDetalheDialog } from '../components/AtendimentoDetalheDialog';
import { idEfetivo } from '../lib/selecao';
import { Vales } from './Vales';
import { Fechamento } from './Fechamento';
import { Reembolsos } from './Reembolsos';

/**
 * Sessão de vale/pagamento: "Comissão" virou "Financeiro" — extrato sozinho
 * não cobre mais tudo que diz respeito ao dinheiro do barbeiro. Sub-abas
 * (mesmo padrão de Catálogo/Pacotes — `Tabs`, sem router) em vez de crescer
 * o bottom-nav: Extrato (todo staff) | Vales (todo staff, escopo por papel
 * já é feito no backend) | Fechamento e Reembolsos (só aparecem pra admin).
 *
 * Sessão 2026-08-17 (Parte 1): Reembolsos veio de "Pacotes & Ofertas" — é
 * dinheiro saindo da casa, pertence aqui. Só realocação de navegação; a regra
 * de reembolso (§8.7) não mudou.
 */
type SubAba = 'extrato' | 'vales' | 'fechamento' | 'reembolsos';

export function Financeiro({ usuario }: { usuario: UsuarioDTO }) {
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [subAba, setSubAba] = useState<SubAba>('extrato');
  // Reembolso é decisão de admin (backend: @Papeis(ADMIN) em
  // /pacotes/reembolsos/*) — sem a aba, nunca mostra caminho que dá 403.
  const tabs = [
    { value: 'extrato' as const, label: 'Extrato' },
    { value: 'vales' as const, label: 'Vales' },
    ...(ehAdmin
      ? [
          { value: 'fechamento' as const, label: 'Fechamento' },
          { value: 'reembolsos' as const, label: 'Reembolsos' },
        ]
      : []),
  ];

  return (
    <div className="px-5">
      <h1 className="m-0 mb-3 text-[26px] font-bold leading-tight">Financeiro</h1>
      <Tabs value={subAba} onChange={setSubAba} tabs={tabs} />
      <div className="mt-4">
        {subAba === 'extrato' && <Extrato usuario={usuario} />}
        {subAba === 'vales' && <Vales usuario={usuario} />}
        {subAba === 'fechamento' && ehAdmin && <Fechamento usuario={usuario} />}
        {subAba === 'reembolsos' && ehAdmin && <Reembolsos />}
      </div>
    </div>
  );
}

/**
 * Sinal do lançamento no saldo — mesma regra de `saldo-do-barbeiro.ts` no
 * backend, aqui só pra exibição.
 *
 * `DESCONTO_CONCEDIDO` (2026-08-25) entra aqui: é comissão que o barbeiro
 * deixou de ganhar. Sem esta linha ele apareceria com "+" e em dourado, como se
 * o desconto que ele deu ao cliente fosse um ganho dele.
 */
function ehDebito(tipo: TipoLancamento): boolean {
  return (
    tipo === TipoLancamento.VALE ||
    tipo === TipoLancamento.PAGAMENTO ||
    tipo === TipoLancamento.DESCONTO_CONCEDIDO
  );
}

function Extrato({ usuario }: { usuario: UsuarioDTO }) {
  const tz = useTimezone();
  const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
  const [barbeiroId, setBarbeiroId] = useState(usuario.barbeiroId);
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const barbeiros = useApi(() => api<BarbeiroDTO[]>('/barbeiros'), []);
  const barbeirosQueAtendem = (barbeiros.dados ?? []).filter((b) => b.papeis.includes(Papel.BARBEIRO));
  // Bug 4: `barbeiroId` (de usuario.barbeiroId) pode não bater com nenhum
  // barbeiro da lista (ex.: admin puro) — o <select> mostrava visualmente o
  // primeiro item, mas o fetch abaixo ainda usava o valor antigo/vazio, só
  // corrigindo quando o usuário trocava manualmente de barbeiro. O valor
  // efetivo (usado tanto no <select> quanto no fetch) já cai no primeiro da
  // lista quando não há seleção válida.
  const barbeiroIdEfetivo = idEfetivo(barbeiroId, barbeirosQueAtendem);
  const { dados, erro, carregando, recarregar } = useApi(
    () => api<ExtratoComissaoDTO>(`/comissao/${barbeiroIdEfetivo}`),
    [barbeiroIdEfetivo],
  );

  return (
    <div>
      <div className="flex gap-2 items-center mb-3">
        {ehAdmin && barbeirosQueAtendem.length > 0 && (
          <select className="select" value={barbeiroIdEfetivo ?? ''} onChange={(e) => setBarbeiroId(e.target.value)}>
            {barbeirosQueAtendem.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nome}
              </option>
            ))}
          </select>
        )}
        <BotaoAtualizar onClick={recarregar} carregando={carregando} />
      </div>
      {carregando && <Loading />}
      {erro && <ErroEstado erro={erro} aoTentar={recarregar} />}
      {dados && (
        <>
          <SaldoLiquido saldoCentavos={dados.saldo.saldoRealCentavos} />
          <div className="card mb-4" style={{ borderStyle: 'dashed' }}>
            <div
              className="text-[11px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              Projeção futura (agendados — pode ser cancelada)
            </div>
            <div className="text-[20px] font-extrabold mt-1" style={{ color: 'var(--text-secondary)' }}>
              {dinheiro(dados.saldo.projecaoFuturaCentavos)}
            </div>
          </div>

          <div className="label">Extrato (ledger)</div>
          {dados.lancamentos.length === 0 && <Vazio texto="Nenhum lançamento ainda." />}
          <div className="flex flex-col gap-2">
            {dados.lancamentos.map((l) => (
              <LinhaDoExtrato key={l.id} lancamento={l} tz={tz} aoVerAtendimento={setSelecionadoId} />
            ))}
          </div>
        </>
      )}
      <AtendimentoDetalheDialog
        atendimentoId={selecionadoId}
        aoFechar={() => setSelecionadoId(null)}
        aoMudar={() => {
          setSelecionadoId(null);
          recarregar();
        }}
        somenteLeitura={!ehAdmin}
        ehAdmin={ehAdmin}
      />
    </div>
  );
}

/**
 * Saldo líquido em destaque — inequívoco por cor E label, nunca só pelo sinal
 * do número: positivo = a casa deve ao barbeiro (dourado, "a receber"),
 * negativo = o barbeiro deve à casa (vermelho, "a devolver").
 */
function SaldoLiquido({ saldoCentavos }: { saldoCentavos: number }) {
  const negativo = saldoCentavos < 0;
  return (
    <div
      className="card mb-2.5"
      style={{ background: negativo ? 'var(--status-danger)' : 'var(--brand-ink)', border: 'none' }}
    >
      <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: negativo ? '#fff' : 'var(--brand-beige)' }}>
        Saldo real {negativo ? '— barbeiro deve à casa' : '— a receber'}
      </div>
      <div className="text-[30px] font-extrabold mt-1" style={{ color: negativo ? '#fff' : 'var(--brand-cream)' }}>
        {dinheiro(Math.abs(saldoCentavos))}
      </div>
    </div>
  );
}

function LinhaDoExtrato({
  lancamento: l,
  tz,
  aoVerAtendimento,
}: {
  lancamento: LancamentoComissaoDTO;
  tz: string;
  aoVerAtendimento: (atendimentoId: string) => void;
}) {
  const debito = ehDebito(l.tipo);
  const dataRotulo = l.atendimentoInicio ? dataCurta(l.atendimentoInicio, tz) : dataCurta(l.ocorridoEm, tz);
  const cor = debito ? 'var(--status-danger)' : 'var(--brand-gold-700)';

  if (l.tipo === TipoLancamento.VALE || l.tipo === TipoLancamento.PAGAMENTO) {
    const rotulo = l.tipo === TipoLancamento.VALE ? 'Vale pago' : 'Pagamento registrado';
    return (
      <div className="card flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-[13px] font-bold truncate">{rotulo}</div>
            <Badge tone={l.tipo === TipoLancamento.VALE ? 'warning' : 'info'}>{l.tipo}</Badge>
          </div>
          <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
            {l.registradoPorNome ? `registrado por ${l.registradoPorNome}` : '—'} · {dataRotulo}
          </div>
        </div>
        <div className="font-extrabold text-[15px] flex-shrink-0" style={{ color: cor }}>
          − {dinheiro(l.valorComissaoCentavos)}
        </div>
      </div>
    );
  }

  /**
   * ★ FASE 3 (2026-08-25) — a transparência que o dono pediu: caixinha e
   * desconto são LINHAS PRÓPRIAS, com nome e sinal próprios. Se o barbeiro não
   * entende por que o número dele mudou, o sistema gera desconfiança sobre
   * dinheiro — que é o que ninguém quer numa barbearia.
   */
  if (l.tipo === TipoLancamento.DESCONTO_CONCEDIDO) {
    return (
      <div className="card flex items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-[13px] font-bold truncate">Desconto concedido (sua parte)</div>
          </div>
          <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
            {l.clienteNome ?? '?'} · {dataRotulo}
          </div>
          {l.valorBaseCentavos !== null && (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              de {dinheiro(l.valorBaseCentavos)} abatidos do cliente
              {/* O percentual passou a existir em 2026-08-26 (antes o desconto
                  era rateado linha a linha e não havia UM número honesto).
                  Lançamentos anteriores continuam sem ele — e a linha tem que
                  continuar legível para esses. */}
              {l.percentualAplicado !== null && <> · {l.percentualAplicado}% é a parte dele</>}
            </div>
          )}
        </div>
        <div className="font-extrabold text-[15px] flex-shrink-0" style={{ color: cor }}>
          − {dinheiro(l.valorComissaoCentavos)}
        </div>
        {l.atendimentoId && (
          <button
            className="btn btn-ghost btn-sm flex-shrink-0"
            aria-label="Ver detalhes do atendimento"
            onClick={() => aoVerAtendimento(l.atendimentoId!)}
          >
            ⓘ
          </button>
        )}
      </div>
    );
  }

  const ehCaixinha = l.origem === OrigemComissao.CAIXINHA;
  const ehProduto = l.origem === OrigemComissao.PRODUTO;
  // Caixinha não tem serviço nem produto: o "item" dela é ela mesma.
  const nomeItem = ehCaixinha ? 'Caixinha' : ehProduto ? l.produtoNome : l.servicoNome;
  return (
    <div className="card flex items-center gap-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-[13px] font-bold truncate">{l.clienteNome ?? '?'}</div>
          {ehProduto && <Badge tone="gold">Produto</Badge>}
          {ehCaixinha && <Badge tone="gold">Caixinha</Badge>}
        </div>
        <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>
          {nomeItem} · {dataRotulo}
        </div>
        {l.valorBaseCentavos !== null && l.percentualAplicado !== null && (
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            base {dinheiro(l.valorBaseCentavos)} × {l.percentualAplicado}%
          </div>
        )}
      </div>
      <div className="font-extrabold text-[15px] flex-shrink-0" style={{ color: cor }}>
        + {dinheiro(l.valorComissaoCentavos)}
      </div>
      {l.atendimentoId && (
        <button
          className="btn btn-ghost btn-sm flex-shrink-0"
          aria-label="Ver detalhes do atendimento"
          onClick={() => aoVerAtendimento(l.atendimentoId!)}
        >
          ⓘ
        </button>
      )}
    </div>
  );
}
