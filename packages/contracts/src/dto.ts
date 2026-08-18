import { TabelaDeDescontoDTO } from './desconto';
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
  StatusVale,
  TipoLancamento,
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
  duracaoMinutos?: number;
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
/**
 * Gestão de usuários (admin only — §CLAUDE.md sessão de CRUD staff): mesmos
 * dados de `BarbeiroDTO` + `login`. Separado de `BarbeiroDTO` de propósito —
 * `GET /barbeiros` é usado por qualquer staff autenticado (agenda, comissão,
 * pacotes) e nunca deveria expor login de outro usuário; só a tela de gestão
 * (admin only) precisa disso.
 */
export interface UsuarioStaffDTO extends BarbeiroDTO {
  /** Login de acesso (staff, AuthProvider local). Null se ainda sem credencial definida. */
  login: string | null;
}
export interface CriarBarbeiroRequest {
  nome: string;
  papeis: Papel[];
  comissaoPadrao: number;
  servicosAtendidos: string[];
  /** Obrigatório: todo usuário novo precisa conseguir logar — não há convite/self-service. */
  login: string;
  senha: string;
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
/** Dados básicos de um usuário staff (gestão de usuários — admin only). */
export interface AtualizarUsuarioRequest {
  nome: string;
  papeis: Papel[];
}
export interface AlterarStatusUsuarioRequest {
  ativo: boolean;
}
/** Ao menos um dos dois campos deve vir preenchido. */
export interface AtualizarCredenciaisRequest {
  login?: string;
  senha?: string;
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
  /**
   * "Da casa" NA RELAÇÃO DE QUEM PERGUNTA — é uma relação barbeiro↔cliente, não
   * um atributo do cliente. O mesmo cliente pode vir `true` para um barbeiro e
   * `false` para outro.
   */
  daCasa: boolean;
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
  cliente: {
    id: string;
    nome: string;
    telefone: string;
    email: string | null;
    /** "Fale sobre você" do funil — o barbeiro lê antes de atender. */
    sobreVoce: string | null;
    /** É "da casa" DO BARBEIRO DESTE ATENDIMENTO (relação, não atributo). */
    daCasa: boolean;
  };
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
  /** Prazo da reserva/intenção (ISO) — sessão de OTP+reserva, front mostra contagem regressiva. */
  expiraEm: string;
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
  /**
   * Barbeiro escolhido PELO CLIENTE na compra (2026-08-18) — só ele atende os
   * serviços deste pacote. `null` = comprou sem escolher, qualquer um atende.
   */
  barbeiroId: string | null;
  barbeiroNome: string | null;
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

// ---------- Comissão / ledger de 3 direções ----------
// COMISSAO (+, origem SERVICO via Atendimento ou PRODUTO via Atendimento —
// add-on — ou VendaDeProduto avulsa) | VALE (−, adiantamento pago) |
// PAGAMENTO (−, quitação registrada pelo admin). `origem`/`valorBaseCentavos`/
// `percentualAplicado` só existem quando tipo=COMISSAO. `valorComissaoCentavos`
// é sempre a MAGNITUDE (positiva) do lançamento — o sinal no saldo líquido
// vem de `tipo`, nunca inverta o número aqui.
export interface LancamentoComissaoDTO {
  id: string;
  barbeiroId: string;
  tipo: TipoLancamento;
  origem: OrigemComissao | null;
  atendimentoId: string | null;
  vendaDeProdutoId: string | null;
  servicoNome: string | null;
  produtoNome: string | null;
  valorBaseCentavos: number | null;
  percentualAplicado: number | null; // porcentagem, null se não for COMISSAO
  valorComissaoCentavos: number;
  /** Quando o lançamento foi registrado (conclusão do atendimento / venda / pagamento). */
  ocorridoEm: string;
  clienteNome: string | null;
  clienteTelefone: string | null;
  /** Data/hora REAL do atendimento (pode diferir de `ocorridoEm`), quando origem=SERVICO/atendimento. */
  atendimentoInicio: string | null;
  /** Só tipo=VALE — rastreia até o pedido original. */
  valeId: string | null;
  /** Só tipo=VALE|PAGAMENTO — quem confirmou que o dinheiro se moveu (admin). */
  registradoPorNome: string | null;
}
/**
 * Saldo real e projeção futura são números SEPARADOS e rotulados.
 * Nunca somar os dois (projeção pode ser cancelada). `saldoRealCentavos`
 * pode ser NEGATIVO (barbeiro deve à casa) — ver `calcularSaldoCentavos`.
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

// ---------- Vale (adiantamento de comissão) ----------
export interface ValeDTO {
  id: string;
  barbeiroId: string;
  barbeiroNome: string;
  valorCentavos: number;
  motivo: string | null;
  status: StatusVale;
  solicitadoEm: string;
  decididoPorId: string | null;
  decididoPorNome: string | null;
  decididoEm: string | null;
  motivoNegacao: string | null;
  pagoPorId: string | null;
  pagoPorNome: string | null;
  pagoEm: string | null;
}
export interface SolicitarValeRequest {
  valorCentavos: number;
  motivo?: string;
}
export interface NegarValeRequest {
  motivo: string;
}

// ---------- Pagamento ao barbeiro ----------
export interface RegistrarPagamentoRequest {
  barbeiroId: string;
  valorCentavos: number;
  /** ISO opcional — quando o pagamento foi feito de fato. Default: agora. */
  data?: string;
}

// ---------- Fechamento / visão de gestão (admin) — leitura, não lançamento ----------
export interface FechamentoBarbeiroDTO {
  barbeiroId: string;
  barbeiroNome: string;
  /** Acumulado histórico total do ledger (não é "do período"). */
  totalComissaoAcumuladaCentavos: number;
  totalValePagoAcumuladoCentavos: number;
  totalPagamentoAcumuladoCentavos: number;
  saldoLiquidoCentavos: number;
  /** Movimento DENTRO do período consultado — nunca confundir com o acumulado acima. */
  comissaoNoPeriodoCentavos: number;
  valeNoPeriodoCentavos: number;
  pagamentoNoPeriodoCentavos: number;
}
export interface FechamentoDTO {
  periodo: { de: string; ate: string };
  barbeiros: FechamentoBarbeiroDTO[];
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
  /**
   * Tabela de desconto progressivo dos avulsos. Vai para o funil porque ele
   * precisa MOSTRAR o desconto antes de o cliente confirmar — usando a mesma
   * função de cálculo que a API usa para cobrar (`calcularDescontoProgressivo`).
   */
  descontoProgressivo: TabelaDeDescontoDTO;
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
export interface DiaDisponivelDTO {
  data: string; // YYYY-MM-DD, dia civil local
  /** false → o seletor de data mostra o dia riscado/desabilitado. */
  disponivel: boolean;
}
/**
 * Disponibilidade de um PERÍODO inteiro numa resposta só. Existe para o funil
 * poder riscar as datas sem horário sem fazer uma requisição por dia.
 */
export interface DiasDisponiveisDTO {
  dias: DiaDisponivelDTO[];
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
  /**
   * Barbeiro que vai atender. Sempre presente — inclusive (e principalmente)
   * quando o cliente escolheu "não tenho preferência" e a atribuição foi do
   * servidor: ele precisa saber com quem ficou.
   */
  barbeiro: { id: string; nome: string };
  /**
   * Total efetivamente cobrado, em centavos. Importa no "sem preferência":
   * preço é por barbeiro, então só dá para saber o valor final depois de
   * atribuir — o funil mostra "a partir de" antes e este número depois.
   */
  valorTotalCentavos: number;
}

export enum TipoItemDeOrderBump {
  SERVICO = 'SERVICO',
  PRODUTO = 'PRODUTO',
}

/**
 * Um item da vitrine "Adicione à sua visita" (DOMAIN.md §8.13), já
 * PRECIFICADO para o barbeiro escolhido.
 *
 * O front nunca recalcula preço promocional a partir de percentual: recebe
 * `precoNormalCentavos` e `precoPromocionalCentavos` prontos e derivada daí a
 * ênfase visual. O percentual vem calculado junto só para exibição.
 */
export interface ItemDeOrderBumpDTO {
  tipo: TipoItemDeOrderBump;
  /** `Servico.id` ou `Produto.id`, conforme `tipo`. */
  id: string;
  nome: string;
  /** Preço cheio do item — para serviço, já é o preço DAQUELE barbeiro. */
  precoNormalCentavos: number;
  /** O que o cliente paga ao adicionar pelo bump. Igual ao normal quando não há oferta. */
  precoPromocionalCentavos: number;
  /** `precoNormal − precoPromocional`. Zero = sem oferta, exibe sem ênfase de promoção. */
  descontoCentavos: number;
  /** Derivado, só para exibição ("−30%"). Zero quando não há oferta. */
  descontoPercentual: number;
  /** Chamada configurada pelo admin ("Leve pra casa por só R$X"). */
  mensagem: string | null;
  /** Só serviço — o bump de serviço ocupa tempo na agenda. */
  duracaoMinutos: number | null;
}

/**
 * Order-bump (sessão 2026-08-17): vitrine de complementos mostrada na
 * confirmação do funil — "Adicione à sua visita". Lista curada e
 * PARAMETRIZADA pelo admin (preço promocional, mensagem, ordem), SEM motor de
 * regras condicionais (decisão do dono, ver DECISOES_PENDENTES). Já vem
 * ordenada; os serviços vêm com o preço do barbeiro escolhido, e cabe ao front
 * esconder os que o cliente já tem no carrinho.
 */
export interface OrderBumpDTO {
  servicos: ItemDeOrderBumpDTO[];
  produtos: ItemDeOrderBumpDTO[];
}

/** Um produto do order-bump escolhido pelo cliente, com a quantidade. */
export interface ProdutoBumpRequest {
  produtoId: string;
  quantidade: number;
}

// ---------- Configuração do order-bump (admin, seção Funil de Vendas) ----------

/** Item do catálogo + como (e se) ele está configurado no bump. */
export interface ConfiguracaoDeOrderBumpDTO {
  tipo: TipoItemDeOrderBump;
  /** `Servico.id` ou `Produto.id`. */
  id: string;
  nome: string;
  /** Preço de referência da casa — base do percentual mostrado ao admin. */
  precoNormalCentavos: number;
  /** true = aparece na vitrine do funil. */
  ativoNoBump: boolean;
  /** null = sem promoção (cobra o preço normal). */
  precoPromocionalCentavos: number | null;
  mensagem: string | null;
  ordem: number;
}

export interface ConfigurarItemDeOrderBumpRequest {
  ativo: boolean;
  /** Preço FINAL em centavos. null remove a promoção. O percentual é derivado, nunca persistido. */
  precoPromocionalCentavos?: number | null;
  mensagem?: string | null;
  ordem?: number;
}

export const MAX_MENSAGEM_BUMP = 90;

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
  /** Preço de REFERÊNCIA DA CASA, base do cálculo da economia (a oferta é da empresa). */
  precoUnitarioCentavos: number;
}
export interface PacoteOfertaDTO {
  id: string;
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

// Pagamento online é OBRIGATÓRIO na trilha de pacote (decisão do dono, sessão
// de pagamento online): garante caixa adiantado, e o domínio já impede
// consumir crédito de pacote não-pago (§3.6) — sem escolha de "pagar na
// barbearia" aqui. `formaPagamento` saiu do request de propósito: não é mais
// o cliente que decide, é sempre cobrança PIX na hora.
export interface VenderPacotePublicoRequest {
  companyId: string;
  ofertaId: string;
  cliente: { nome: string; telefone: string };
  /**
   * Barbeiro escolhido no funil. Presente ⇒ só ele atende os serviços deste
   * pacote (2026-08-18). Ausente = "não tenho preferência": qualquer um atende.
   */
  barbeiroId?: string | null;
}
export interface VenderPacotePublicoResponse {
  vendaId: string;
  clienteId: string;
  /** intenção de pagamento — sempre presente (para consultar status / reconciliar). */
  intencaoId: string;
  /** cobrança PIX — sempre presente (pagamento online é obrigatório no pacote). */
  cobranca: CobrancaDTO | null;
}

// ---------- Status de pagamento (polling do funil online) ----------
export interface PagamentoStatusDTO {
  intencaoId: string;
  status: StatusPagamento;
  /**
   * Prazo da reserva/intenção (sessão de OTP+reserva) — ISO, null quando não
   * é pagamento online (presencial) ou em linhas anteriores a essa sessão.
   * O front usa pra mostrar contagem regressiva ("reservado por 9:59...").
   */
  expiraEm: string | null;
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

// ---------- Webhook AbacatePay (Checkout Transparente, formato v2) ----------
// Formato confirmado contra a documentação oficial da AbacatePay — payload
// v2: { id, event, apiVersion, devMode, data }. Pra eventos `transparent.*`,
// os detalhes da cobrança ficam ANINHADOS em `data.transparent` (não direto
// em `data` como no v1) — `externalId` mora em `data.transparent.externalId`.
// Só os eventos assinados nesta conta chegam aqui de fato: `transparent.completed`
// (pagamento confirmado) e `transparent.lost` (disputa/chargeback PERDIDA —
// NÃO é "PIX expirou", apesar do nome; expiração é detectada por timeout local,
// nunca por webhook — a AbacatePay não emite evento nenhum pra QR Code que
// simplesmente nunca foi pago). Payload deliberadamente frouxo (campos extras
// tolerados) — a própria AbacatePay recomenda não validar contra schema rígido
// pra não quebrar com mudanças futuras deles.
export interface WebhookAbacatePayRequest {
  id?: string; // id do evento (idempotência do lado deles) — ex: "log_abc123xyz"
  event?: string; // ex: "transparent.completed", "transparent.lost"
  apiVersion?: number; // 2
  devMode?: boolean;
  data?: {
    transparent?: {
      id?: string; // id da cobrança no gateway
      externalId?: string;
      amount?: number;
      paidAmount?: number;
      status?: string; // "PAID" quando completed
      [k: string]: unknown;
    };
    // Fallbacks defensivos — nunca usados pelo payload v2 real de transparent.*,
    // mantidos só por tolerância (a AbacatePay pode adicionar formatos novos).
    status?: string;
    externalId?: string;
    metadata?: { externalId?: string };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
