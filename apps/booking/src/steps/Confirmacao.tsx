import type { OrderBumpDTO, ServicoDTO, TabelaDeDescontoDTO } from '@bigods/contracts';
import { dinheiro, rotuloDia } from '../lib/format';
import {
  precificarCarrinhoFunil,
  precificarProdutosBump,
  promocionaisDoBump,
  type FormaPagamento,
  type FunnelState,
} from '../lib/funnel-state';
import { ResumoDoDesconto } from '../components/ResumoDoDesconto';
import { OrderBump } from '../components/OrderBump';
import { AlertaErro } from '../components/ui';
import { BARBEARIA } from '../lib/barbearia';
import { useEmpresa } from '../lib/empresa-context';

export function Confirmacao({
  estado,
  servicos,
  tabelaDeDesconto,
  orderBump,
  enviando,
  erroEnvio,
  onFormaPagamento,
  onToggleServicoBump,
  onToggleProdutoBump,
  onConfirmar,
}: {
  estado: FunnelState;
  servicos: ServicoDTO[];
  tabelaDeDesconto: TabelaDeDescontoDTO;
  /** Vitrine "Adicione à sua visita" — null enquanto carrega/sem itens. Só existe no avulso. */
  orderBump: OrderBumpDTO | null;
  enviando: boolean;
  erroEnvio: string | null;
  onFormaPagamento: (f: FormaPagamento) => void;
  onToggleServicoBump: (servicoId: string) => void;
  onToggleProdutoBump: (produtoId: string) => void;
  onConfirmar: () => void;
}) {
  const ehPacote = estado.modo === 'pacote';
  // Mesmo cálculo da API (função compartilhada `precificarCarrinhoDoFunil`): o
  // total exibido aqui é o que será cobrado, item a item — inclusive o preço
  // promocional dos itens que vieram do bump, que substitui (não empilha com)
  // o desconto progressivo.
  const promocionais = promocionaisDoBump(orderBump, estado.servicosBump);
  const carrinho = precificarCarrinhoFunil(servicos, estado.servicoIds, tabelaDeDesconto, promocionais);
  const produtosBumpCentavos = ehPacote ? 0 : precificarProdutosBump(orderBump?.produtos ?? [], estado.produtosBump);
  const total = ehPacote ? (estado.ofertaPrecoCentavos ?? 0) : carrinho.totalFinalCentavos + produtosBumpCentavos;
  const dia = estado.data ? rotuloDia(estado.data).longo : '';
  // O preço mostrado é referência da casa enquanto não há barbeiro definido.
  const precoEstimado = !ehPacote && estado.semPreferencia && !estado.barbeiroId;

  const linha = (rotulo: string, valor: string) => (
    <div className="flex justify-between text-[14px]">
      <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
      <span className="font-bold text-right">{valor}</span>
    </div>
  );

  // Pacote: pagamento online é OBRIGATÓRIO (decisão do dono) — nunca oferece
  // "pagar na barbearia" aqui, garante caixa adiantado antes de liberar
  // crédito. Avulso: cliente escolhe (default presencial).
  const online = ehPacote || estado.formaPagamento === 'online';
  // Modo manual (TEMPORÁRIO): o "pagar agora" não gera QR, leva pro WhatsApp
  // da barbearia. Prometer PIX na hora aqui e entregar outra coisa na tela
  // seguinte é o tipo de surpresa que faz o cliente desistir no checkout.
  const viaWhatsapp = useEmpresa().pagamentoManualWhatsapp === true;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[22px] font-extrabold">{ehPacote ? 'Confirmar compra' : 'Confirmar agendamento'}</div>

      <div className="flex flex-col gap-2.5 rounded-2xl p-4" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface-card)' }}>
        {ehPacote ? (
          <div className="flex justify-between text-[14px]">
            <span className="font-bold">{estado.ofertaNome}</span>
            <span className="font-bold">{dinheiro(total)}</span>
          </div>
        ) : (
          <>
            <div
              className="text-[11px] font-bold uppercase"
              style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}
            >
              Serviços Realizados
            </div>
            <div className="flex flex-col gap-1.5">
              {carrinho.itens.map((item) => {
                const veioDoBump = estado.servicosBump.includes(item.servico.id);
                return (
                  <div key={item.servico.id} className="flex justify-between items-center text-[14px] gap-2">
                    <span className="min-w-0 flex items-center gap-1.5">
                      <span className="truncate">{item.servico.nome}</span>
                      {item.promocional && <span className="bump-selo">oferta</span>}
                      {/* Remover ali mesmo — o cliente nunca precisa refazer o
                          funil para tirar um complemento que ele adicionou. */}
                      {veioDoBump && (
                        <button
                          className="bump-remover"
                          aria-label={`Remover ${item.servico.nome}`}
                          onClick={() => onToggleServicoBump(item.servico.id)}
                        >
                          remover
                        </button>
                      )}
                    </span>
                    <span className="font-bold flex-shrink-0">
                      {/* Preço cheio riscado ao lado do cobrado: sem isso o
                          desconto some da percepção do cliente. */}
                      {item.descontoCentavos > 0 && (
                        <span
                          className="font-semibold mr-1.5"
                          style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}
                        >
                          {dinheiro(item.precoCheioCentavos)}
                        </span>
                      )}
                      {dinheiro(item.precoFinalCentavos)}
                    </span>
                  </div>
                );
              })}
            </div>
            {carrinho.temDesconto && <ResumoDoDesconto carrinho={carrinho} />}
            {estado.produtosBump.length > 0 && (
              <>
                <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
                <div
                  className="text-[11px] font-bold uppercase"
                  style={{ letterSpacing: '0.06em', color: 'var(--text-muted)' }}
                >
                  Produtos
                </div>
                <div className="flex flex-col gap-1.5">
                  {estado.produtosBump.map((sel) => {
                    const produto = orderBump?.produtos.find((p) => p.id === sel.produtoId);
                    if (!produto) return null;
                    const temOferta = produto.descontoCentavos > 0;
                    return (
                      <div key={sel.produtoId} className="flex justify-between items-center text-[14px] gap-2">
                        <span className="min-w-0 flex items-center gap-1.5">
                          <span className="truncate">
                            {produto.nome}
                            {sel.quantidade > 1 && ` ×${sel.quantidade}`}
                          </span>
                          {temOferta && <span className="bump-selo">oferta</span>}
                          <button
                            className="bump-remover"
                            aria-label={`Remover ${produto.nome}`}
                            onClick={() => onToggleProdutoBump(sel.produtoId)}
                          >
                            remover
                          </button>
                        </span>
                        <span className="font-bold flex-shrink-0">
                          {temOferta && (
                            <span
                              className="font-semibold mr-1.5"
                              style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}
                            >
                              {dinheiro(produto.precoNormalCentavos * sel.quantidade)}
                            </span>
                          )}
                          {dinheiro(produto.precoPromocionalCentavos * sel.quantidade)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
            {estado.barbeiroNome
              ? linha('Barbeiro', estado.barbeiroNome)
              : estado.semPreferencia && linha('Barbeiro', 'A definir')}
            {linha('Quando', `${dia} · ${estado.horaInicio}`)}
          </>
        )}
        <div className="h-px" style={{ background: 'var(--border-subtle)' }} />
        <div className="flex justify-between items-baseline">
          <span className="font-extrabold text-[15px]">Total</span>
          <span className="font-extrabold text-[18px]">
            {/* Sem preferência, o preço é por barbeiro e o barbeiro só é
                definido na confirmação — então aqui é "a partir de", nunca um
                valor cravado que pode mudar. */}
            {precoEstimado && (
              <span className="font-semibold text-[13px] mr-1" style={{ color: 'var(--text-muted)' }}>
                a partir de
              </span>
            )}
            {dinheiro(total)}
          </span>
        </div>
      </div>

      {/* Order-bump: avulso-only — pacote é crédito pré-pago, sem Atendimento pra anexar produto/serviço. */}
      {!ehPacote && (
        <OrderBump
          dados={orderBump}
          estado={estado}
          onToggleServico={onToggleServicoBump}
          onToggleProduto={onToggleProdutoBump}
        />
      )}

      {/* Escolha de pagamento (online/presencial) só existe no avulso — pacote é sempre online. */}
      {!ehPacote && (
        <div>
          <div className="label">Como quer pagar?</div>
          <div className="grid grid-cols-2 gap-2.5">
            <PagBtn
              ativo={online}
              titulo="Pagar agora"
              sub={viaWhatsapp ? 'PIX pelo WhatsApp' : 'PIX na hora'}
              onClick={() => onFormaPagamento('online')}
            />
            <PagBtn ativo={!online} titulo="Pagar na barbearia" sub="no dia" onClick={() => onFormaPagamento('presencial')} />
          </div>
        </div>
      )}

      <div
        className="flex items-start gap-2.5 rounded-2xl p-4 text-[13px]"
        style={{ background: 'var(--surface-brand-tint)', color: 'var(--brand-gold-700)' }}
      >
        <span className="text-[16px] leading-none mt-0.5">{online ? '📲' : '💈'}</span>
        <div>
          {ehPacote && viaWhatsapp ? (
            <>
              <strong>Pagamento por PIX, obrigatório na compra de pacote.</strong> Na próxima tela você
              abre o WhatsApp da barbearia com o pedido pronto e recebe o PIX por lá; seus créditos são
              liberados assim que o pagamento for confirmado.
            </>
          ) : ehPacote ? (
            <>
              <strong>Pagamento por PIX, obrigatório na compra de pacote.</strong> Você recebe o QR Code na próxima
              tela; seus créditos são liberados assim que o pagamento confirmar.
            </>
          ) : online && viaWhatsapp ? (
            <>
              <strong>Pagamento por PIX pelo WhatsApp.</strong> Na próxima tela você abre a conversa com o
              pedido pronto e recebe o PIX por lá. Seu horário fica reservado até a confirmação.
            </>
          ) : online ? (
            <>
              <strong>Pagamento por PIX.</strong> Você recebe o QR Code na próxima tela; a confirmação é automática.
            </>
          ) : (
            <>
              <strong>Pagamento na barbearia.</strong> Você paga no balcão no dia do atendimento — nada é cobrado
              agora. Aceitamos {BARBEARIA.formasDePagamentoPresencial.join(', ')}.
            </>
          )}
        </div>
      </div>

      {precoEstimado && (
        <div
          className="rounded-2xl p-3.5 text-[12.5px]"
          style={{ background: 'var(--surface-sunken)', color: 'var(--text-secondary)' }}
        >
          Como você não escolheu profissional, o valor pode variar um pouco conforme quem for te
          atender. Você vê o nome dele e o preço final na próxima tela, antes de qualquer cobrança.
        </div>
      )}

      {erroEnvio && <AlertaErro texto={erroEnvio} />}

      <button className="btn btn-lg btn-block" disabled={enviando} onClick={onConfirmar}>
        {enviando ? 'Enviando…' : online ? 'Ir para o pagamento →' : 'Confirmar horário'}
      </button>
    </div>
  );
}

function PagBtn({ ativo, titulo, sub, onClick }: { ativo: boolean; titulo: string; sub: string; onClick: () => void }) {
  return (
    <button className={`selectable ${ativo ? 'selected' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} onClick={onClick}>
      <span className="font-bold text-[14px]">{titulo}</span>
      <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
        {sub}
      </span>
    </button>
  );
}
