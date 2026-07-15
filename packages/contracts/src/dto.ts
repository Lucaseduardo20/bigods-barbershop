import {
  FormaPagamento,
  OrigemAtendimento,
  Papel,
  StatusAtendimento,
  StatusItemPacote,
  StatusPagamento,
} from './enums';

// ---------- Auth ----------
export interface LoginRequest {
  login: string;
  senha: string;
}
export interface UsuarioDTO {
  barbeiroId: string;
  companyId: string;
  nome: string;
  papeis: Papel[];
}
export interface LoginResponse {
  token: string;
  usuario: UsuarioDTO;
}

// ---------- Catálogo ----------
export interface ServicoDTO {
  id: string;
  nome: string;
  precoAvulsoCentavos: number;
  duracaoMinutos: number;
  ativo: boolean;
}
export interface CriarServicoRequest {
  nome: string;
  precoAvulsoCentavos: number;
  duracaoMinutos: number;
}
export interface AtualizarServicoRequest {
  nome?: string;
  precoAvulsoCentavos?: number;
  ativo?: boolean;
}

// ---------- Staff ----------
export interface ExcecaoComissaoDTO {
  servicoId: string;
  percentual: number; // porcentagem (ex: 60)
}
export interface BarbeiroDTO {
  id: string;
  nome: string;
  papeis: Papel[];
  comissaoPadrao: number; // porcentagem (ex: 45)
  excecoesComissao: ExcecaoComissaoDTO[];
  servicosAtendidos: string[];
  ativo: boolean;
}
export interface CriarBarbeiroRequest {
  nome: string;
  papeis: Papel[];
  comissaoPadrao: number;
  servicosAtendidos: string[];
  login?: string;
  senha?: string;
}
export interface AtualizarComissaoRequest {
  comissaoPadrao: number;
  excecoes: ExcecaoComissaoDTO[];
}
export interface DisponibilidadeDTO {
  id: string;
  barbeiroId: string;
  data: string; // YYYY-MM-DD, dia civil local (fuso da empresa)
  inicio: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
  fim: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
}
export interface CriarDisponibilidadeRequest {
  barbeiroId: string;
  data: string; // YYYY-MM-DD, dia civil local
  inicio: string; // "HH:mm", horário de parede LOCAL (fuso da empresa) — nunca ISO/UTC
  fim: string; // "HH:mm", horário de parede LOCAL
}

// ---------- Clientes ----------
export interface ClienteDTO {
  id: string;
  nome: string;
  telefone: string;
  possuiConta: boolean;
}

// ---------- Agenda ----------
export interface ItemAtendidoDTO {
  servicoId: string;
  servicoNome: string;
  valorCobradoCentavos: number;
  duracaoMinutos: number;
  itemDoPacoteId: string | null;
}
export interface AtendimentoDTO {
  id: string;
  cliente: { id: string; nome: string; telefone: string };
  barbeiro: { id: string; nome: string };
  itens: ItemAtendidoDTO[];
  inicio: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
  fim: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
  status: StatusAtendimento;
  origem: OrigemAtendimento;
  formaPagamento: FormaPagamento | null;
  motivoCancelamento: string | null;
  valorTotalCentavos: number;
}
export interface AgendarAvulsoRequest {
  barbeiroId: string;
  servicoIds: string[];
  data: string; // YYYY-MM-DD, dia civil local
  horaInicio: string; // "HH:mm", horário de parede LOCAL (fuso da empresa)
  cliente: { nome: string; telefone: string };
  gerarCobranca?: boolean;
}
export interface AgendarComCreditoRequest {
  vendaId: string;
  itemId: string;
  barbeiroId: string;
  data: string; // YYYY-MM-DD, dia civil local
  horaInicio: string; // "HH:mm", horário de parede LOCAL
}
export interface ConcluirAtendimentoRequest {
  formaPagamento?: FormaPagamento;
}
export interface CancelarAtendimentoRequest {
  motivo: string;
}
export interface CobrancaDTO {
  intencaoId: string;
  qrCode: string;
  copiaECola: string;
}
export interface AgendarResponse {
  atendimentoId: string;
  cobranca: CobrancaDTO | null;
}

// ---------- Pacotes ----------
export interface ItemDoPacoteDTO {
  id: string;
  servicoId: string;
  servicoNome: string;
  valorRateadoCentavos: number;
  status: StatusItemPacote;
  faltasComputadas: number;
  prazoReagendamentoAte: string | null;
  atendimentoId: string | null;
}
export interface VendaDePacoteDTO {
  id: string;
  cliente: { id: string; nome: string; telefone: string };
  valorPagoCentavos: number;
  saldoResidualCentavos: number;
  compradoEm: string;
  statusPagamento: StatusPagamento;
  itens: ItemDoPacoteDTO[];
}
export interface VenderPacoteRequest {
  cliente: { nome: string; telefone: string };
  servicoIds: string[];
  valorPagoCentavos: number;
  pagamentoImediato: boolean;
}
export interface VenderPacoteResponse {
  vendaId: string;
  clienteId: string;
  cobranca: CobrancaDTO | null;
}

// ---------- Comissão ----------
export interface LancamentoComissaoDTO {
  id: string;
  barbeiroId: string;
  atendimentoId: string;
  servicoId: string;
  servicoNome: string;
  valorBaseCentavos: number;
  percentualAplicado: number; // porcentagem
  valorComissaoCentavos: number;
  /** Quando o lançamento foi registrado (conclusão do atendimento). */
  ocorridoEm: string;
  clienteNome: string;
  clienteTelefone: string;
  /** Data/hora REAL do atendimento (pode diferir de `ocorridoEm`, se concluído depois do horário marcado). */
  atendimentoInicio: string;
}
/**
 * Saldo real e projeção futura são números SEPARADOS e rotulados.
 * Nunca somar os dois (projeção pode ser cancelada).
 */
export interface SaldoComissaoDTO {
  barbeiroId: string;
  saldoRealCentavos: number;
  projecaoFuturaCentavos: number;
}
export interface ExtratoComissaoDTO {
  saldo: SaldoComissaoDTO;
  lancamentos: LancamentoComissaoDTO[];
}

// ---------- Parâmetros ----------
export interface ParametrosDTO {
  prazoReagendamentoDias: number;
  /** Fuso IANA da empresa (ex: "America/Sao_Paulo"). Frontend deve SEMPRE renderizar
   * datas/horas neste fuso — nunca no fuso do navegador/dispositivo do usuário. */
  timezone: string;
}

// ---------- Funil público de agendamento (booking) ----------
// Superfície não autenticada. O tenant é explícito: o funil carrega o
// `companyId` (deploy da própria barbearia) e o envia em toda chamada —
// nunca há resolução implícita/fallback de empresa no servidor (DOMAIN.md §2.4).

export interface EmpresaPublicaDTO {
  companyId: string;
  nome: string;
  /** Fuso IANA da empresa — o funil renderiza datas/horas nele, nunca no fuso do navegador. */
  timezone: string;
}
export interface BarbeiroPublicoDTO {
  id: string;
  nome: string;
}
export interface HorarioDisponivelDTO {
  horaInicio: string; // "HH:mm", horário de parede LOCAL (fuso da empresa)
  inicioIso: string; // instante absoluto UTC (ISO 8601) correspondente
}
export interface HorariosDisponiveisDTO {
  data: string; // YYYY-MM-DD, dia civil local consultado
  horarios: HorarioDisponivelDTO[];
}
export interface AgendarPublicoRequest {
  companyId: string;
  barbeiroId: string;
  servicoIds: string[];
  data: string; // YYYY-MM-DD, dia civil local
  horaInicio: string; // "HH:mm", horário de parede LOCAL
  cliente: { nome: string; telefone: string };
}
export interface AgendarPublicoResponse {
  atendimentoId: string;
}

// ---------- Webhook AbacatePay (payload documentado) ----------
export interface WebhookAbacatePayRequest {
  event: string; // ex: "billing.paid"
  data: {
    metadata: { externalId: string };
  };
}
