import type { ServicoDTO } from '@bigods/contracts';

/**
 * Passos do funil. O passo Barbeiro é pulado quando só há um barbeiro que
 * atende os serviços escolhidos (barbeiroAuto=true).
 */
export const PASSO = {
  LANDING: 0,
  SERVICOS: 1,
  BARBEIRO: 2,
  DATA_HORA: 3,
  DADOS: 4,
  CONFIRMACAO: 5,
  // Trilha de pacote: bifurcação do funil avulso (reusa DADOS e CONFIRMACAO).
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
  /** true quando o barbeiro foi pré-selecionado por ser o único disponível. */
  barbeiroAuto: boolean;
  data: string | null; // YYYY-MM-DD, dia civil local
  horaInicio: string | null; // "HH:mm" local
  nome: string;
  telefone: string;
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
  data: null,
  horaInicio: null,
  nome: '',
  telefone: '',
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
  return estado;
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

export function servicosSelecionados(servicos: ServicoDTO[], ids: string[]): ServicoDTO[] {
  return ids.map((id) => servicos.find((s) => s.id === id)).filter((s): s is ServicoDTO => !!s);
}

export function totalCentavos(servicos: ServicoDTO[], ids: string[]): number {
  return servicosSelecionados(servicos, ids).reduce((acc, s) => acc + s.precoAvulsoCentavos, 0);
}

export function duracaoMinutos(servicos: ServicoDTO[], ids: string[]): number {
  return servicosSelecionados(servicos, ids).reduce((acc, s) => acc + s.duracaoMinutos, 0);
}
