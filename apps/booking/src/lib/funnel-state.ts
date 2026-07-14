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
} as const;

export interface FunnelState {
  step: number;
  servicoIds: string[];
  barbeiroId: string | null;
  barbeiroNome: string | null; // snapshot para exibir na confirmação/sucesso
  /** true quando o barbeiro foi pré-selecionado por ser o único disponível. */
  barbeiroAuto: boolean;
  data: string | null; // YYYY-MM-DD, dia civil local
  horaInicio: string | null; // "HH:mm" local
  nome: string;
  telefone: string;
}

export const estadoInicial: FunnelState = {
  step: PASSO.LANDING,
  servicoIds: [],
  barbeiroId: null,
  barbeiroNome: null,
  barbeiroAuto: false,
  data: null,
  horaInicio: null,
  nome: '',
  telefone: '',
};

const CHAVE = 'bigods.booking.v1';

/** Persistência do progresso — sobrevive a refresh. É sessionStorage, NÃO o banco. */
export function carregarEstado(): FunnelState {
  try {
    const raw = sessionStorage.getItem(CHAVE);
    if (!raw) return estadoInicial;
    return { ...estadoInicial, ...(JSON.parse(raw) as Partial<FunnelState>) };
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
