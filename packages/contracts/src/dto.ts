import {
  FormaPagamento,
  OrigemAtendimento,
  OrigemComissao,
  OrigemDisponibilidade,
  Papel,
  StatusAprovacaoPacoteOferta,
  StatusAtendimento,
  StatusItemPacote,
  StatusPagamento,
  StatusSolicitacaoReembolso,
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
// Override de preço por serviço (sessão-B, Fase 2) — ausência = usa
// Servico.precoAvulso (referência da casa). Mesmo padrão de ExcecaoComissaoDTO.
export interface ExcecaoPrecoDTO {
  servicoId: string;
  precoCentavos: number;
}
export interface BarbeiroDTO {
  id: string;
  nome: string;
  /** Link pessoal de marketing (§4b) — "/?barbeiro={slug}". Único por empresa. */
  slug: string;
  papeis: Papel[];
  comissaoPadrao: number; // porcentagem (ex: 45)
  excecoesComissao: ExcecaoComissaoDTO[];
  servicosAtendidos: string[];
  /**
   * Percentual ÚNICO de comissão sobre produto, para TODOS os produtos —
   * sem matriz por produto (decisão consciente: a matriz por serviço existe
   * por margens de mão de obra distintas; produto é revenda). Default 0%.
   */
  comissaoProdutos: number; // porcentagem
  /** Overrides de preço por serviço — ausência de um serviço aqui = usa a referência da casa. */
  precosServicos: ExcecaoPrecoDTO[];
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
  comissaoProdutos: number;
}
export interface AtualizarPrecosRequest {
  precos: ExcecaoPrecoDTO[];
}
export interface AtualizarSlugRequest {
  slug: string;
}

// ---------- Expediente semanal recorrente ----------
// Gera (materializa) as janelas de Disponibilidade dos próximos dias. A
// disponibilidade por dia continua existindo e editável individualmente
// (folga pontual, feriado) — o expediente é o gerador, o dia é a exceção.
export interface JanelaExpedienteDTO {
  inicio: string; // "HH:mm", horário de parede LOCAL (fuso da empresa)
  fim: string; // "HH:mm", horário de parede LOCAL
}
export interface DiaDeExpedienteDTO {
  /** 0=domingo .. 6=sábado (mesma convenção de Date.getUTCDay() sobre o dia civil). */
  diaSemana: number;
  janelas: JanelaExpedienteDTO[];
}
export interface ExpedienteSemanalDTO {
  barbeiroId: string;
  dias: DiaDeExpedienteDTO[];
}
export interface DefinirExpedienteRequest {
  dias: DiaDeExpedienteDTO[];
}
export interface DisponibilidadeDTO {
  id: string;
  barbeiroId: string;
  data: string; // YYYY-MM-DD, dia civil local (fuso da empresa)
  inicio: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
  fim: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
  /** EXPEDIENTE (gerada pelo expediente semanal) ou MANUAL (folga/exceção pontual editada à mão). */
  origem: OrigemDisponibilidade;
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
export interface ItemProdutoAtendidoDTO {
  produtoId: string;
  produtoNome: string;
  quantidade: number;
  valorUnitarioCentavos: number;
}
export interface AtendimentoDTO {
  id: string;
  cliente: { id: string; nome: string; telefone: string };
  barbeiro: { id: string; nome: string };
  itens: ItemAtendidoDTO[];
  produtos: ItemProdutoAtendidoDTO[];
  inicio: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
  fim: string; // ISO 8601 UTC (instante absoluto) — renderizar no fuso da empresa
  status: StatusAtendimento;
  origem: OrigemAtendimento;
  formaPagamento: FormaPagamento | null;
  motivoCancelamento: string | null;
  valorTotalCentavos: number;
  /** true se há uma IntencaoDePagamento PAGA vinculada — visível mesmo antes de concluir. */
  pagoOnline: boolean;
  /** Valor já coberto pelo pagamento online (0 se não pago online). */
  valorPagoOnlineCentavos: number;
  /** Fase 4c (sessão-B) — de qual barbeiro veio o link pessoal que originou este agendamento, se veio de algum. Só registro, sem métrica. */
  origemLinkBarbeiroId: string | null;
  origemLinkBarbeiroNome: string | null;
  /** FASE 4a (sessão-E, §8.7) — quanto deste atendimento foi abatido com saldo residual de pacote (0 = nenhum). */
  valorAbatidoSaldoCentavos: number;
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
  /**
   * Obrigatória apenas quando há valor a cobrar não coberto por pagamento
   * online/crédito de pacote (ex.: atendimento avulso comum, ou pago online
   * com item/produto adicionado na conclusão — nesse caso cobre só o adicional).
   */
  formaPagamento?: FormaPagamento;
}
export interface CancelarAtendimentoRequest {
  motivo: string;
}
export interface AdicionarItemAtendimentoRequest {
  servicoId: string;
}
export interface AdicionarProdutoAtendimentoRequest {
  produtoId: string;
  quantidade?: number; // default 1
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
  /** Dono do pacote (Fase 2) — crédito só pode ser consumido com ele. */
  barbeiroId: string;
  barbeiroNome: string;
  valorPagoCentavos: number;
  saldoResidualCentavos: number;
  /** FASE 4a (sessão-E, §8.7) — soma já abatida em agendamentos avulsos. */
  saldoUtilizadoCentavos: number;
  /** FASE 4b — reservado por uma SolicitacaoDeReembolso PENDENTE (já saiu do saldo residual). */
  saldoReservadoReembolsoCentavos: number;
  /** FASE 4b — confirmado e devolvido manualmente pelo admin. */
  saldoReembolsadoCentavos: number;
  /** FASE 4b — prazo pra pedir reembolso deste saldo residual; `null` se não há saldo disponível. */
  prazoReembolsoAte: string | null;
  compradoEm: string;
  statusPagamento: StatusPagamento;
  itens: ItemDoPacoteDTO[];
  /** Fase 4c (sessão-B) — de qual barbeiro veio o link pessoal que originou esta compra, se veio de algum. Só registro, sem métrica. */
  origemLinkBarbeiroId: string | null;
  origemLinkBarbeiroNome: string | null;
}

/** FASE 4b (sessão-E, §8.7): pedido de reembolso manual do saldo residual de um pacote. */
export interface SolicitacaoDeReembolsoDTO {
  id: string;
  vendaDePacoteId: string;
  cliente: { id: string; nome: string; telefone: string };
  valorCentavos: number;
  criadaEm: string;
  prazoLimiteEm: string;
  status: StatusSolicitacaoReembolso;
  reembolsadaEm: string | null;
}
export interface VenderPacoteRequest {
  barbeiroId: string;
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
// Generalizado para cobrir origem SERVICO (via Atendimento) e PRODUTO (via
// Atendimento — add-on — ou VendaDeProduto avulsa). Exatamente um par
// (atendimentoId|vendaDeProdutoId) e (servicoNome|produtoNome) é preenchido.
export interface LancamentoComissaoDTO {
  id: string;
  barbeiroId: string;
  origem: OrigemComissao;
  atendimentoId: string | null;
  vendaDeProdutoId: string | null;
  servicoNome: string | null;
  produtoNome: string | null;
  valorBaseCentavos: number;
  percentualAplicado: number; // porcentagem
  valorComissaoCentavos: number;
  /** Quando o lançamento foi registrado (conclusão do atendimento / venda). */
  ocorridoEm: string;
  clienteNome: string;
  clienteTelefone: string;
  /** Data/hora REAL do atendimento (pode diferir de `ocorridoEm`), quando origem=SERVICO/atendimento. */
  atendimentoInicio: string | null;
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
  /** §8.6 (sessão-E): até quantas horas antes o cliente pode cancelar sozinho pelo cockpit. */
  janelaCancelamentoHoras: number;
  /** §8.6 (sessão-E): até quantas horas antes o cliente pode reagendar sozinho pelo cockpit. */
  janelaReagendamentoHoras: number;
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
  /**
   * `true` quando a API roda em modo demo (DEMO_MODE): o funil pode exibir
   * afordâncias de demonstração (ex.: simular o pagamento PIX sem gateway real).
   * SEMPRE `false` em produção (o boot recusa DEMO_MODE=true em produção).
   */
  demoMode: boolean;
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
  /** online → gera cobrança PIX; presencial (default) → pagar na barbearia. */
  formaPagamento?: FormaPagamentoFunil;
}
export interface AgendarPublicoResponse {
  atendimentoId: string;
  /** intenção de pagamento quando online (para consultar status); null se presencial. */
  intencaoId: string | null;
  /** cobrança PIX quando online; null se presencial. */
  cobranca: CobrancaDTO | null;
}

// ---------- Área do cliente (login OTP por telefone) ----------
// Tenant explícito: o app da conta carrega o `companyId` (deploy da barbearia)
// e o envia em toda chamada — sem resolução implícita de empresa (§2.4).

export interface IniciarLoginClienteRequest {
  companyId: string;
  telefone: string;
}
export interface IniciarLoginClienteResponse {
  /** Token opaco do desafio, reapresentado na confirmação. */
  desafio: string;
  /** Quando o código expira (ISO 8601 UTC). */
  expiraEm: string;
  /** SOMENTE em modo demo (DEMO_MODE=true): o código, para testar sem SMS. Senão null. */
  codigoDemo: string | null;
}
export interface ConfirmarLoginClienteRequest {
  companyId: string;
  telefone: string;
  codigo: string;
  desafio: string;
}
export interface ClienteSessaoDTO {
  id: string;
  nome: string;
  telefone: string;
}
export interface ConfirmarLoginClienteResponse {
  /** Token de sessão do cliente — Bearer nas chamadas da área logada. */
  token: string;
  cliente: ClienteSessaoDTO;
}
/** Agendamento futuro do cliente (read model da área logada). */
export interface AgendamentoClienteDTO {
  atendimentoId: string;
  /** instante absoluto UTC (ISO 8601); o front renderiza no fuso da empresa. */
  inicioIso: string;
  servicoNomes: string[];
  barbeiroNome: string;
  origem: OrigemAtendimento;
  status: StatusAtendimento;
}
export interface PerfilClienteDTO {
  cliente: ClienteSessaoDTO;
  /** Pacotes do cliente (reusa o read model de pacotes). */
  pacotes: VendaDePacoteDTO[];
  /** Próximos atendimentos AGENDADOS do cliente, do mais próximo ao mais distante. */
  proximosAgendamentos: AgendamentoClienteDTO[];
}

// ---------- Ofertas de pacote (agregado PacoteOferta — sessão-B) ----------
// PacoteOferta é agregado de domínio com dono (barbeiroId) e composição MISTA
// (N serviços distintos, cada um com sua quantidade). O preço é a fonte de
// verdade persistida; o percentual de desconto é sempre DERIVADO na exibição.
export interface ItemComposicaoPacoteDTO {
  servicoId: string;
  servicoNome: string;
  quantidade: number;
  /** Preço de referência unitário usado no cálculo da economia (§ preço por barbeiro, Fase 2). */
  precoUnitarioCentavos: number;
}
export interface PacoteOfertaDTO {
  id: string;
  barbeiroId: string;
  barbeiroNome: string;
  nome: string;
  composicao: ItemComposicaoPacoteDTO[];
  /** Preço do pacote (o que o cliente paga) — única fonte de verdade. */
  precoCentavos: number;
  /** Soma dos preços de referência da composição — base do desconto exibido. */
  precoAvulsoTotalCentavos: number;
  /** economia = precoAvulsoTotalCentavos - precoCentavos (nunca negativa). */
  economiaCentavos: number;
  /** Percentual de desconto DERIVADO (1 casa decimal) — nunca persistido. */
  economiaPercentual: number;
  ativo: boolean;
  /** Workflow de aprovação (Fase 3) — só APROVADO aparece no funil público. */
  statusAprovacao: StatusAprovacaoPacoteOferta;
  /** Preenchido só quando REJEITADO. */
  motivoRejeicao: string | null;
}

export interface ItemComposicaoPacoteRequest {
  servicoId: string;
  quantidade: number;
}
export interface CriarPacoteOfertaRequest {
  barbeiroId: string;
  nome: string;
  composicao: ItemComposicaoPacoteRequest[];
  precoCentavos: number;
}
export interface AtualizarPacoteOfertaRequest {
  nome: string;
  composicao: ItemComposicaoPacoteRequest[];
  precoCentavos: number;
}
export interface AtualizarStatusPacoteOfertaRequest {
  ativo: boolean;
}
export interface RejeitarPacoteOfertaRequest {
  motivo: string;
}

// ---------- Compra de pacote pública (funil) ----------
export type FormaPagamentoFunil = 'online' | 'presencial';

export interface VenderPacotePublicoRequest {
  companyId: string;
  ofertaId: string;
  cliente: { nome: string; telefone: string };
  /** online → gera cobrança PIX real; presencial → pagar na barbearia (fica AGUARDANDO). */
  formaPagamento: FormaPagamentoFunil;
}
export interface VenderPacotePublicoResponse {
  vendaId: string;
  clienteId: string;
  /** intenção de pagamento — sempre presente (para consultar status / reconciliar). */
  intencaoId: string;
  /** cobrança PIX quando formaPagamento=online; null quando presencial. */
  cobranca: CobrancaDTO | null;
}

// ---------- Status de pagamento (polling do funil online) ----------
export interface PagamentoStatusDTO {
  intencaoId: string;
  status: StatusPagamento;
}

// ---------- Agendar com crédito na área do cliente ----------
export interface AgendarComCreditoContaRequest {
  vendaId: string;
  itemId: string;
  barbeiroId: string;
  data: string; // YYYY-MM-DD, dia civil local
  horaInicio: string; // "HH:mm", horário de parede LOCAL
}
export interface AgendarComCreditoContaResponse {
  atendimentoId: string;
}

// ---------- Produtos (venda avulsa, SEM controle de estoque) ----------
// Catálogo mínimo: sem quantidade/estoque/fornecedor (decisão consciente,
// DECISOES_PENDENTES). Soft-disable como Servico — nunca deletar (histórico).
export interface ProdutoDTO {
  id: string;
  nome: string;
  precoCentavos: number;
  ativo: boolean;
}
export interface CriarProdutoRequest {
  nome: string;
  precoCentavos: number;
}
export interface AtualizarProdutoRequest {
  nome?: string;
  precoCentavos?: number;
  ativo?: boolean;
}

export interface ItemVendaDeProdutoDTO {
  produtoId: string;
  produtoNome: string;
  quantidade: number;
  valorUnitarioCentavos: number;
}
export interface VendaDeProdutoDTO {
  id: string;
  barbeiroId: string;
  barbeiroNome: string;
  clienteId: string | null;
  clienteNome: string | null;
  itens: ItemVendaDeProdutoDTO[];
  formaPagamento: FormaPagamento;
  valorTotalCentavos: number;
  vendidoEm: string; // ISO 8601 UTC
}
export interface VenderProdutoAvulsoRequest {
  barbeiroId: string;
  clienteId?: string;
  itens: { produtoId: string; quantidade: number }[];
  formaPagamento: FormaPagamento;
}
export interface VenderProdutoAvulsoResponse {
  vendaId: string;
}

// ---------- Webhook AbacatePay ----------
// Payload deliberadamente frouxo: extraímos só `event`/`status` e o `externalId`
// (que pode vir em metadata direto ou aninhado). A AbacatePay recomenda não
// validar o payload inteiro contra um schema rígido para não quebrar com
// mudanças futuras deles.
export interface WebhookAbacatePayRequest {
  event?: string; // ex: "billing.paid", "transparent.completed"
  data?: {
    status?: string; // ex: "PAID"
    externalId?: string;
    metadata?: { externalId?: string };
    pixQrCode?: { metadata?: { externalId?: string } };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
