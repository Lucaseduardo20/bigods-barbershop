import { useState } from 'react';
import type { AtendimentoDTO, ProdutoDTO, ServicoDTO } from '@bigods/contracts';
import { FormaPagamento } from '@bigods/contracts';
import { api } from '../lib/api';
import { resumoDoFechamento } from '../lib/fechamento';
import { dataCurta, dinheiro, hora } from '../lib/format';
import { useTimezone } from '../lib/tz-context';
import { CurrencyInput, Dialog } from './ui';

/**
 * FECHAR COMANDA EM DUAS ETAPAS (2026-08-25, FASE 2).
 *
 * A tela anterior misturava tudo num acordeão só: adicionar serviço, adicionar
 * produto, escolher forma de pagamento e concluir, um embaixo do outro. O
 * Gabriel reclamou que era confusa — e era: as duas perguntas que ele responde
 * ali são de naturezas diferentes, e apareciam juntas.
 *
 *   ETAPA 1 — COMANDA    "o que realmente aconteceu no atendimento"
 *   ETAPA 2 — PAGAMENTO  "como foi pago"
 *
 * Uma decisão de cada vez, com o total sempre à vista, e voltar é um clique.
 * Mobile-first porque o barbeiro fecha a comanda no celular, de pé, com o
 * cliente esperando: alvos grandes, uma coluna, o número que importa em
 * destaque no rodapé.
 */

type Etapa = 'comanda' | 'pagamento';

const FORMAS: { valor: FormaPagamento; rotulo: string }[] = [
  { valor: FormaPagamento.PIX, rotulo: 'PIX' },
  { valor: FormaPagamento.DINHEIRO, rotulo: 'Dinheiro' },
  { valor: FormaPagamento.CARTAO_DEBITO, rotulo: 'Débito' },
  { valor: FormaPagamento.CARTAO_CREDITO, rotulo: 'Crédito' },
];

export function FecharComandaDialog({
  atendimento,
  servicos,
  produtos,
  ehAdmin,
  aoAtualizar,
  aoFechar,
  aoConcluir,
}: {
  atendimento: AtendimentoDTO;
  servicos: ServicoDTO[];
  produtos: ProdutoDTO[];
  ehAdmin: boolean;
  /** Recarrega o atendimento depois de uma edição da comanda. */
  aoAtualizar: () => void;
  aoFechar: () => void;
  /** Concluiu de verdade (ou mandou para aprovação): quem chamou decide o que fazer. */
  aoConcluir: () => void;
}) {
  const tz = useTimezone();
  const a = atendimento;
  const [etapa, setEtapa] = useState<Etapa>('comanda');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [servicoParaAdicionar, setServicoParaAdicionar] = useState('');
  const [produtoParaAdicionar, setProdutoParaAdicionar] = useState('');
  const [qtdProduto, setQtdProduto] = useState('1');

  const [forma, setForma] = useState<FormaPagamento>(FormaPagamento.PIX);
  const [caixinhaCentavos, setCaixinha] = useState(0);
  const [descontoCentavos, setDesconto] = useState(0);
  const [mostrarCaixinha, setMostrarCaixinha] = useState(false);
  const [mostrarDesconto, setMostrarDesconto] = useState(false);

  // Conclusão antecipada (2026-08-20): o barbeiro não conclui sozinho um
  // atendimento cujo horário não chegou. Aqui é só a coleta do motivo.
  const [motivoAntecipada, setMotivoAntecipada] = useState('');
  const [enviadoParaAprovacao, setEnviadoParaAprovacao] = useState(false);
  const antesDoHorario = Date.now() < new Date(a.inicio).getTime();
  const precisaJustificar = antesDoHorario && !ehAdmin;

  const resumo = resumoDoFechamento(a, { caixinhaCentavos, descontoCentavos });
  const precisaFormaPagamento = resumo.aCobrarCentavos > 0;
  const descontoAcimaDoTeto = descontoCentavos > resumo.descontoMaximoCentavos;

  const executar = async (fn: () => Promise<unknown>, depois: () => void) => {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      depois();
    } catch (e) {
      setErro(String((e as Error).message));
      // Recarrega mesmo no erro: o motivo mais comum de a edição falhar é a
      // comanda ter mudado (outra aba, o admin do lado). Deixar a tela velha na
      // frente do barbeiro faria o próximo clique errar de novo.
      aoAtualizar();
    } finally {
      setOcupado(false);
    }
  };

  const concluir = () =>
    executar(
      () =>
        api(`/atendimentos/${a.id}/concluir`, {
          method: 'POST',
          body: {
            ...(precisaFormaPagamento ? { formaPagamento: forma } : {}),
            ...(precisaJustificar ? { motivoConclusaoAntecipada: motivoAntecipada.trim() } : {}),
            ...(caixinhaCentavos > 0 ? { caixinhaCentavos } : {}),
            ...(descontoCentavos > 0 ? { descontoCentavos } : {}),
          },
        }),
      () => (precisaJustificar ? setEnviadoParaAprovacao(true) : aoConcluir()),
    );

  if (enviadoParaAprovacao) {
    return (
      <Dialog open onClose={aoConcluir} title="Enviado para aprovação">
        <div className="flex flex-col gap-3">
          <div className="text-[13px]">
            O atendimento de <strong>{a.cliente.nome}</strong> ficou aguardando aprovação do
            administrador. Ele <strong>ainda não está concluído</strong>, e a comissão só entra no
            seu extrato depois da aprovação.
          </div>
          <button className="btn" onClick={aoConcluir}>
            Entendi
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={aoFechar} title={etapa === 'comanda' ? 'Comanda' : 'Pagamento'}>
      <div className="flex flex-col gap-3">
        <PassoAPasso etapa={etapa} />

        <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{a.cliente.nome}</strong> ·{' '}
          {dataCurta(a.inicio, tz)} às {hora(a.inicio, tz)} · {a.barbeiro.nome}
        </div>

        {etapa === 'comanda' ? (
          <EtapaComanda
            a={a}
            servicos={servicos}
            produtos={produtos}
            ocupado={ocupado}
            servicoParaAdicionar={servicoParaAdicionar}
            setServicoParaAdicionar={setServicoParaAdicionar}
            produtoParaAdicionar={produtoParaAdicionar}
            setProdutoParaAdicionar={setProdutoParaAdicionar}
            qtdProduto={qtdProduto}
            setQtdProduto={setQtdProduto}
            executar={executar}
            aoAtualizar={aoAtualizar}
          />
        ) : (
          <EtapaPagamento
            a={a}
            resumo={resumo}
            forma={forma}
            setForma={setForma}
            precisaFormaPagamento={precisaFormaPagamento}
            caixinhaCentavos={caixinhaCentavos}
            setCaixinha={setCaixinha}
            descontoCentavos={descontoCentavos}
            setDesconto={setDesconto}
            mostrarCaixinha={mostrarCaixinha}
            setMostrarCaixinha={setMostrarCaixinha}
            mostrarDesconto={mostrarDesconto}
            setMostrarDesconto={setMostrarDesconto}
            descontoAcimaDoTeto={descontoAcimaDoTeto}
            precisaJustificar={precisaJustificar}
            motivoAntecipada={motivoAntecipada}
            setMotivoAntecipada={setMotivoAntecipada}
          />
        )}

        {erro && (
          <div className="text-[13px]" style={{ color: 'var(--status-danger)' }}>
            {erro}
          </div>
        )}

        {/* Rodapé fixo da decisão: o número grande e UM botão. O barbeiro está
            de pé, com o cliente esperando — não é hora de caçar o botão certo. */}
        <div
          className="flex flex-col gap-2 pt-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <div className="flex justify-between items-baseline">
            <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              {etapa === 'comanda' ? 'Total da comanda' : 'A receber agora'}
            </span>
            <span className="text-[20px] font-extrabold">
              {dinheiro(
                etapa === 'comanda' ? resumo.totalDaComandaCentavos : resumo.aReceberCentavos,
              )}
            </span>
          </div>

          {etapa === 'comanda' ? (
            <button
              className="btn"
              disabled={ocupado || a.itens.length === 0}
              onClick={() => setEtapa('pagamento')}
            >
              {a.itens.length === 0 ? 'Adicione um serviço para continuar' : 'Ir para o pagamento →'}
            </button>
          ) : (
            <>
              <button
                className="btn"
                disabled={
                  ocupado ||
                  descontoAcimaDoTeto ||
                  (precisaJustificar && motivoAntecipada.trim().length < 3)
                }
                onClick={concluir}
              >
                {ocupado
                  ? 'Concluindo…'
                  : precisaJustificar
                    ? 'Enviar para aprovação'
                    : 'Concluir atendimento'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => setEtapa('comanda')}>
                ← Voltar para a comanda
              </button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Onde o barbeiro está e quanto falta. Dois passos não precisam de mais que isto. */
function PassoAPasso({ etapa }: { etapa: Etapa }) {
  const passo = (rotulo: string, ativo: boolean, feito: boolean) => (
    <div className="flex items-center gap-1.5 flex-1">
      <span
        className="text-[11px] font-bold"
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          background: ativo || feito ? 'var(--accent-primary)' : 'var(--surface-sunken)',
          color: ativo || feito ? 'var(--brand-cream)' : 'var(--text-muted)',
        }}
      >
        {feito ? '✓' : rotulo[0]}
      </span>
      <span
        className="text-[12px] font-bold"
        style={{ color: ativo ? 'var(--text-primary)' : 'var(--text-muted)' }}
      >
        {rotulo}
      </span>
    </div>
  );
  return (
    <div className="flex items-center gap-2">
      {passo('1 Comanda', etapa === 'comanda', etapa === 'pagamento')}
      {passo('2 Pagamento', etapa === 'pagamento', false)}
    </div>
  );
}

/** ETAPA 1 — o que realmente aconteceu no atendimento. */
function EtapaComanda({
  a,
  servicos,
  produtos,
  ocupado,
  servicoParaAdicionar,
  setServicoParaAdicionar,
  produtoParaAdicionar,
  setProdutoParaAdicionar,
  qtdProduto,
  setQtdProduto,
  executar,
  aoAtualizar,
}: {
  a: AtendimentoDTO;
  servicos: ServicoDTO[];
  produtos: ProdutoDTO[];
  ocupado: boolean;
  servicoParaAdicionar: string;
  setServicoParaAdicionar: (v: string) => void;
  produtoParaAdicionar: string;
  setProdutoParaAdicionar: (v: string) => void;
  qtdProduto: string;
  setQtdProduto: (v: string) => void;
  executar: (fn: () => Promise<unknown>, depois: () => void) => Promise<void>;
  aoAtualizar: () => void;
}) {
  const podeRemover = a.podeEditarComanda;

  return (
    <>
      <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
        Confira o que foi feito. Tirou, colocou ou trocou alguma coisa? Ajuste aqui — o total se
        refaz sozinho.
      </div>

      <div className="card flex flex-col" style={{ background: 'var(--surface-sunken)' }}>
        {a.itens.length === 0 && a.produtos.length === 0 && (
          <div className="text-[13px] py-2" style={{ color: 'var(--text-muted)' }}>
            A comanda está vazia.
          </div>
        )}

        {a.itens.map((i, idx) => (
          <LinhaDaComanda
            key={`s${idx}`}
            nome={i.servicoNome}
            /* Item de crédito de pacote não mostra preço de venda: ele já foi
               pago na compra do pacote, e exibir o rateado como se fosse uma
               cobrança confunde na hora de acertar. */
            detalhe={i.itemDoPacoteId ? 'crédito de pacote' : undefined}
            precoCheioCentavos={i.precoCheioCentavos}
            valorCentavos={i.valorCobradoCentavos}
            podeRemover={podeRemover && !ocupado}
            aoRemover={() =>
              executar(
                () =>
                  api(`/atendimentos/${a.id}/itens/${idx}?servicoId=${encodeURIComponent(i.servicoId)}`, {
                    method: 'DELETE',
                  }),
                aoAtualizar,
              )
            }
          />
        ))}

        {a.produtos.map((p, idx) => (
          <LinhaDaComanda
            key={`p${idx}`}
            nome={p.produtoNome}
            detalhe={p.quantidade > 1 ? `${p.quantidade} unidades` : undefined}
            precoCheioCentavos={null}
            valorCentavos={p.valorUnitarioCentavos * p.quantidade}
            podeRemover={podeRemover && !ocupado}
            aoRemover={() =>
              executar(
                () =>
                  api(`/atendimentos/${a.id}/produtos/${idx}?produtoId=${encodeURIComponent(p.produtoId)}`, {
                    method: 'DELETE',
                  }),
                aoAtualizar,
              )
            }
          />
        ))}

        {a.descontoProgressivoCentavos > 0 && (
          <div
            className="flex justify-between text-[12px] py-1.5 mt-1"
            style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--brand-gold-700)' }}
          >
            <span>Desconto por combinar serviços</span>
            <span className="font-bold">− {dinheiro(a.descontoProgressivoCentavos)}</span>
          </div>
        )}
      </div>

      {!podeRemover && a.motivoBloqueioEdicao && (
        <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          {a.motivoBloqueioEdicao} Você ainda pode adicionar itens — o adicional é cobrado no
          fechamento.
        </div>
      )}

      <div className="card flex flex-col gap-2">
        <div
          className="text-[11px] font-bold uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}
        >
          Adicionar
        </div>
        <div className="flex gap-2">
          <select
            className="select flex-1"
            aria-label="Serviço para adicionar"
            value={servicoParaAdicionar}
            onChange={(e) => setServicoParaAdicionar(e.target.value)}
          >
            <option value="">Serviço…</option>
            {servicos
              .filter((s) => s.ativo)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} · {dinheiro(s.precoAvulsoCentavos)}
                </option>
              ))}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            disabled={ocupado || !servicoParaAdicionar}
            onClick={() =>
              executar(
                () =>
                  api(`/atendimentos/${a.id}/itens`, {
                    method: 'POST',
                    body: { servicoId: servicoParaAdicionar },
                  }),
                () => {
                  setServicoParaAdicionar('');
                  aoAtualizar();
                },
              )
            }
          >
            + Add
          </button>
        </div>
        <div className="flex gap-2">
          <select
            className="select flex-1"
            aria-label="Produto para adicionar"
            value={produtoParaAdicionar}
            onChange={(e) => setProdutoParaAdicionar(e.target.value)}
          >
            <option value="">Produto…</option>
            {produtos
              .filter((p) => p.ativo)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} · {dinheiro(p.precoCentavos)}
                </option>
              ))}
          </select>
          <input
            className="input"
            style={{ width: 56 }}
            type="number"
            min={1}
            aria-label="Quantidade"
            value={qtdProduto}
            onChange={(e) => setQtdProduto(e.target.value)}
          />
          <button
            className="btn btn-ghost btn-sm"
            disabled={ocupado || !produtoParaAdicionar}
            onClick={() =>
              executar(
                () =>
                  api(`/atendimentos/${a.id}/produtos`, {
                    method: 'POST',
                    body: {
                      produtoId: produtoParaAdicionar,
                      quantidade: parseInt(qtdProduto, 10) || 1,
                    },
                  }),
                () => {
                  setProdutoParaAdicionar('');
                  setQtdProduto('1');
                  aoAtualizar();
                },
              )
            }
          >
            + Add
          </button>
        </div>
      </div>
    </>
  );
}

function LinhaDaComanda({
  nome,
  detalhe,
  precoCheioCentavos,
  valorCentavos,
  podeRemover,
  aoRemover,
}: {
  nome: string;
  detalhe?: string;
  precoCheioCentavos: number | null;
  valorCentavos: number;
  podeRemover: boolean;
  aoRemover: () => void;
}) {
  const teveDesconto = precoCheioCentavos !== null && precoCheioCentavos > valorCentavos;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex-1">
        <div className="text-[13px]">{nome}</div>
        {detalhe && (
          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {detalhe}
          </div>
        )}
      </div>
      <div className="text-right">
        {teveDesconto && (
          <div
            className="text-[11px]"
            style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}
          >
            {dinheiro(precoCheioCentavos!)}
          </div>
        )}
        <div className="text-[13px] font-bold">{dinheiro(valorCentavos)}</div>
      </div>
      {podeRemover && (
        <button
          className="btn btn-ghost btn-sm"
          style={{ padding: '6px 10px' }}
          aria-label={`Remover ${nome}`}
          title={`Remover ${nome}`}
          onClick={aoRemover}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** ETAPA 2 — como foi pago. */
function EtapaPagamento({
  a,
  resumo,
  forma,
  setForma,
  precisaFormaPagamento,
  caixinhaCentavos,
  setCaixinha,
  descontoCentavos,
  setDesconto,
  mostrarCaixinha,
  setMostrarCaixinha,
  mostrarDesconto,
  setMostrarDesconto,
  descontoAcimaDoTeto,
  precisaJustificar,
  motivoAntecipada,
  setMotivoAntecipada,
}: {
  a: AtendimentoDTO;
  resumo: ReturnType<typeof resumoDoFechamento>;
  forma: FormaPagamento;
  setForma: (f: FormaPagamento) => void;
  precisaFormaPagamento: boolean;
  caixinhaCentavos: number;
  setCaixinha: (v: number) => void;
  descontoCentavos: number;
  setDesconto: (v: number) => void;
  mostrarCaixinha: boolean;
  setMostrarCaixinha: (v: boolean) => void;
  mostrarDesconto: boolean;
  setMostrarDesconto: (v: boolean) => void;
  descontoAcimaDoTeto: boolean;
  precisaJustificar: boolean;
  motivoAntecipada: string;
  setMotivoAntecipada: (v: string) => void;
}) {
  return (
    <>
      <div className="card flex flex-col" style={{ background: 'var(--surface-sunken)' }}>
        <div
          className="text-[11px] font-bold uppercase mb-1"
          style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}
        >
          O que foi feito
        </div>
        {[...a.itens.map((i) => i.servicoNome), ...a.produtos.map((p) => p.produtoNome)].map(
          (nome, idx) => (
            <div key={idx} className="text-[13px] py-0.5">
              {nome}
            </div>
          ),
        )}
        <div
          className="flex justify-between text-[13px] pt-2 mt-1"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <span>Total da comanda</span>
          <span className="font-bold">{dinheiro(resumo.totalDaComandaCentavos)}</span>
        </div>
        {resumo.jaCobertoCentavos > 0 && (
          <div className="flex justify-between text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            <span>Já pago (pacote, online ou saldo)</span>
            <span>− {dinheiro(resumo.jaCobertoCentavos)}</span>
          </div>
        )}
      </div>

      {precisaFormaPagamento ? (
        <div>
          <div className="label">Como o cliente pagou os {dinheiro(resumo.aCobrarCentavos)}?</div>
          {/* Botões em vez de <select>: o barbeiro está no celular, e um toque
              vale mais que abrir uma lista e escolher. */}
          <div className="flex gap-2 flex-wrap">
            {FORMAS.map((f) => (
              <button
                key={f.valor}
                className={forma === f.valor ? 'btn btn-sm' : 'btn btn-ghost btn-sm'}
                style={{ flex: '1 1 40%' }}
                onClick={() => setForma(f.valor)}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Nada a cobrar — este atendimento já está pago.
        </div>
      )}

      {/* CAIXINHA E DESCONTO — ações EXPLÍCITAS. O sistema nunca deduz gorjeta de
          "o cliente pagou mais": quem declara é quem estava na cadeira, e isso
          vira lançamento imutável no extrato.
          Quanto de cada um fica com o barbeiro vem do acerto configurado por
          admin em Usuários (2026-08-26) — a tela não repete o percentual porque
          ele é por barbeiro e mudaria de comanda para comanda. */}
      <div className="card flex flex-col gap-2">
        <div
          className="text-[11px] font-bold uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}
        >
          Acerto final
        </div>

        {mostrarCaixinha ? (
          <div>
            <label className="label" htmlFor="caixinha">
              Caixinha para {a.barbeiro.nome}
            </label>
            <div className="flex gap-2">
              <CurrencyInput centavos={caixinhaCentavos} onChange={setCaixinha} style={{ flex: 1 }} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setCaixinha(0);
                  setMostrarCaixinha(false);
                }}
              >
                Remover
              </button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setMostrarCaixinha(true)}>
            + Adicionar caixinha
          </button>
        )}

        {mostrarDesconto ? (
          <div>
            <label className="label" htmlFor="desconto">
              Desconto concedido
            </label>
            <div className="flex gap-2">
              <CurrencyInput centavos={descontoCentavos} onChange={setDesconto} style={{ flex: 1 }} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDesconto(0);
                  setMostrarDesconto(false);
                }}
              >
                Remover
              </button>
            </div>
            {descontoAcimaDoTeto ? (
              <div className="text-[12px] mt-1" style={{ color: 'var(--status-danger)' }}>
                O desconto não pode passar de {dinheiro(resumo.descontoMaximoCentavos)}, que é o que
                o cliente ainda deve.
              </div>
            ) : (
              <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                Parte deste desconto sai da comissão do barbeiro, conforme o acerto configurado para
                ele — e aparece como uma linha separada no extrato.
              </div>
            )}
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            disabled={resumo.descontoMaximoCentavos === 0}
            onClick={() => setMostrarDesconto(true)}
          >
            + Aplicar desconto
          </button>
        )}
      </div>

      {precisaJustificar && (
        <div>
          <label className="label" htmlFor="motivo-antecipada">
            Este atendimento ainda não começou — explique o motivo
          </label>
          <textarea
            id="motivo-antecipada"
            className="input"
            rows={3}
            placeholder="Ex: cliente chegou adiantado e pediu para adiantar o corte"
            value={motivoAntecipada}
            onChange={(e) => setMotivoAntecipada(e.target.value)}
          />
          <div className="text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            O administrador precisa aprovar antes de a comissão ser lançada.
          </div>
        </div>
      )}
    </>
  );
}
