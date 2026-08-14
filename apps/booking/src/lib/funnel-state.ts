import { calcularDescontoProgressivo } from '@bigods/contracts';
import type { BarbeiroPublicoDTO, ServicoDTO, TabelaDeDescontoDTO } from '@bigods/contracts';

/**
 * Passos do funil. §4a: barbeiro vem ANTES de serviço/pacote nas duas
 * trilhas — com preço por barbeiro, mostrar preço sem saber o barbeiro é
 * mostrar preço errado. O passo Barbeiro é pulado quando só existe um
 * barbeiro na casa (barbeiroAuto=true) ou quando veio de um link pessoal
 * (barbeiroFixadoPorLink=true, §4b).
 */
export const PASSO = {
  LANDING: 0,
  BARBEIRO: 1,
  SERVICOS: 2,
  DATA_HORA: 3,
  DADOS: 4,
  CONFIRMACAO: 5,
  /**
   * LEGADO — o passo separado de escolha de pacote deixou de existir quando o
   * funil foi unificado: o Bigod's Club passou a viver na MESMA tela dos
   * serviços (PASSO.SERVICOS). A constante fica só para migrar progresso salvo
   * em sessionStorage de antes da mudança; nada navega para cá.
   */
  PACOTE_OFERTA: 6,
} as const;

/** avulso = agenda um horário; pacote = compra créditos pré-pagos. */
export type ModoFunil = 'avulso' | 'pacote';
export type FormaPagamento = 'online' | 'presencial';

export interface FunnelState {
  step: number;
  modo: ModoFunil;
  servicoIds: string[];
  barbeiroId: string | null;
  barbeiroNome: string | null; // snapshot para exibir na confirmação/sucesso
  /** true quando o barbeiro foi pré-selecionado por ser o único da casa. */
  barbeiroAuto: boolean;
  /** true quando o barbeiro veio do link pessoal dele (§4b) — mostra "Agendando com X" e a saída "ver outros profissionais". */
  barbeiroFixadoPorLink: boolean;
  data: string | null; // YYYY-MM-DD, dia civil local
  horaInicio: string | null; // "HH:mm" local
  nome: string;
  telefone: string;
  /** Opcionais do formulário — vão para o cadastro do cliente se preenchidos. */
  email: string;
  /** "Fale sobre você": o barbeiro lê no detalhe do atendimento. */
  sobreVoce: string;
  // ---- trilha de pacote ----
  ofertaId: string | null;
  ofertaNome: string | null;
  ofertaPrecoCentavos: number | null;
  // ---- pagamento (ambas as trilhas) ----
  formaPagamento: FormaPagamento;
  /** Compra/agendamento concluído nesta sessão — estado final (§ bug 1). */
  concluido: boolean;
}

export const estadoInicial: FunnelState = {
  step: PASSO.LANDING,
  modo: 'avulso',
  servicoIds: [],
  barbeiroId: null,
  barbeiroNome: null,
  barbeiroAuto: false,
  barbeiroFixadoPorLink: false,
  data: null,
  horaInicio: null,
  nome: '',
  telefone: '',
  email: '',
  sobreVoce: '',
  ofertaId: null,
  ofertaNome: null,
  ofertaPrecoCentavos: null,
  formaPagamento: 'presencial',
  concluido: false,
};

const CHAVE = 'bigods.booking.v1';

/**
 * Uma compra/agendamento concluído é estado final: nunca resume no meio do
 * funil. Sem isso, um refresh após pagar restaura o passo de Confirmação
 * salvo em sessionStorage e reabre o pagamento de um pacote já PAGO (bug 1).
 * Função pura (sem I/O) para ser testável sem depender de sessionStorage.
 */
export function sanitizarEstadoCarregado(bruto: Partial<FunnelState>): FunnelState {
  const estado = { ...estadoInicial, ...bruto };
  if (estado.concluido) return estadoInicial;
  // Funil único: quem tinha progresso salvo no antigo passo de pacote cai na
  // tela unificada (clube + serviços) em vez de numa tela que não existe mais.
  if (estado.step === PASSO.PACOTE_OFERTA) {
    return { ...estado, step: PASSO.SERVICOS };
  }
  return estado;
}

/**
 * §4b: um link pessoal de barbeiro SEMPRE vence o estado salvo — se havia
 * progresso de uma visita anterior (possivelmente com outro barbeiro), ele é
 * descartado, não só sobrescrito no campo barbeiroId (senão um serviço já
 * selecionado que o barbeiro do link não atende ficaria "escolhido" sem
 * sentido). Fica só em LANDING — a escolha avulso/pacote continua acontecendo
 * normalmente, só a etapa de ESCOLHER barbeiro é que é pulada depois.
 */
export function aplicarBarbeiroDoLink(barbeiroId: string, barbeiroNome: string): FunnelState {
  return {
    ...estadoInicial,
    barbeiroId,
    barbeiroNome,
    barbeiroFixadoPorLink: true,
  };
}

/** Persistência do progresso — sobrevive a refresh. É sessionStorage, NÃO o banco. */
export function carregarEstado(): FunnelState {
  try {
    const raw = sessionStorage.getItem(CHAVE);
    if (!raw) return estadoInicial;
    return sanitizarEstadoCarregado(JSON.parse(raw) as Partial<FunnelState>);
  } catch {
    return estadoInicial;
  }
}

export function salvarEstado(estado: FunnelState): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify(estado));
  } catch {
    /* storage indisponível (modo privado): funil segue em memória */
  }
}

export function limparEstado(): void {
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* ignore */
  }
}

/**
 * BUG (sessão-D) — "loading eterno" com barbeiro único: a decisão de
 * auto-selecionar era tomada dentro do componente `Barbeiro` (via um efeito
 * próprio, isolado do componente pai `Funil`), que chamava `onSelect` pra
 * avisar o pai. O disparo da busca de serviços por barbeiro
 * (`GET /public/servicos?barbeiroId=`) mora em `Funil`, reage a
 * `estado.barbeiroId` — dependia inteiramente desse round-trip
 * filho→callback→pai acontecer sem nenhum imprevisto de timing entre dois
 * componentes diferentes. Movida pra cá: `Funil` decide sozinho, no mesmo
 * componente que já dispara a busca de serviços, eliminando essa
 * dependência entre componentes. Função pura, testável sem DOM/efeito.
 */
export function barbeiroParaAutoSelecionar(
  barbeiros: BarbeiroPublicoDTO[] | null,
  barbeiroIdAtual: string | null,
): { id: string; nome: string } | null {
  if (!barbeiros || barbeiros.length !== 1) return null;
  const unico = barbeiros[0]!;
  if (barbeiroIdAtual === unico.id) return null; // já resolvido — evita reaplicar em loop
  return { id: unico.id, nome: unico.nome };
}

export function servicosSelecionados(servicos: ServicoDTO[], ids: string[]): ServicoDTO[] {
  return ids.map((id) => servicos.find((s) => s.id === id)).filter((s): s is ServicoDTO => !!s);
}

export function totalCentavos(servicos: ServicoDTO[], ids: string[]): number {
  return servicosSelecionados(servicos, ids).reduce((acc, s) => acc + s.precoAvulsoCentavos, 0);
}

export interface ItemDoCarrinhoFunil {
  servico: ServicoDTO;
  precoCheioCentavos: number;
  descontoCentavos: number;
  precoFinalCentavos: number;
}

export interface CarrinhoFunil {
  itens: ItemDoCarrinhoFunil[];
  totalCheioCentavos: number;
  descontoTotalCentavos: number;
  totalFinalCentavos: number;
  temDesconto: boolean;
}

/**
 * Preço do carrinho de avulsos COM o desconto progressivo.
 *
 * Usa `calcularDescontoProgressivo` de `@bigods/contracts` — exatamente a mesma
 * função que a API usa para cobrar. É isso que garante que o número mostrado
 * aqui é o número que vai ser cobrado: um cálculo próprio no front seria uma
 * segunda verdade sobre dinheiro, e a diferença apareceria como cobrança
 * "errada" para o cliente.
 *
 * Os preços já vêm do `/public/servicos` filtrado pelo barbeiro escolhido, ou
 * seja, são a base DAQUELE barbeiro (com override, se houver).
 */
export function precificarCarrinhoFunil(
  servicos: ServicoDTO[],
  ids: string[],
  tabela: TabelaDeDescontoDTO,
): CarrinhoFunil {
  const selecionados = servicosSelecionados(servicos, ids);
  const calculo = calcularDescontoProgressivo(
    selecionados.map((s) => s.precoAvulsoCentavos),
    tabela,
  );
  return {
    itens: selecionados.map((servico, i) => ({
      servico,
      precoCheioCentavos: servico.precoAvulsoCentavos,
      descontoCentavos: calculo.descontosPorItemCentavos[i] ?? 0,
      precoFinalCentavos: servico.precoAvulsoCentavos - (calculo.descontosPorItemCentavos[i] ?? 0),
    })),
    totalCheioCentavos: calculo.totalCheioCentavos,
    descontoTotalCentavos: calculo.descontoTotalCentavos,
    totalFinalCentavos: calculo.totalFinalCentavos,
    temDesconto: calculo.descontoTotalCentavos > 0,
  };
}

export function duracaoMinutos(servicos: ServicoDTO[], ids: string[]): number {
  return servicosSelecionados(servicos, ids).reduce((acc, s) => acc + s.duracaoMinutos, 0);
}
