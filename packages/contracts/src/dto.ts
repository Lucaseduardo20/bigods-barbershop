import { TabelaDeDescontoDTO } from './desconto';
import {
  FormaPagamento,
  OrigemAtendimento,
  OrigemComissao,
  OrigemDisponibilidade,
  Papel,
  StatusAprovacaoPacoteOferta,
  StatusAtendimento,
  StatusDoClube,
  StatusItemPacote,
  StatusPagamento,
  StatusSolicitacaoReembolso,
  StatusVale,
  TipoLancamento,
  MotivoPublicoDaRecusa,
  ResultadoDoCartao,
} from './enums';
import type { MeioDePagamentoOnline } from './enums';

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
   * ⚠️ DEPRECADO em 2026-08-19 (decisão dos sócios): a comissão de produto virou
   * uma taxa ÚNICA DA EMPRESA — `ParametrosDTO.comissaoProdutos`. Ninguém lê
   * este campo para calcular comissão; ele continua no DTO só para não quebrar
   * cliente antigo. Não construa tela em cima dele.
   */
  comissaoProdutos: number; // porcentagem
  /** Overrides de preço por serviço — ausência de um serviço aqui = usa a referência da casa. */
  precosServicos: ExcecaoPrecoDTO[];
  /**
   * ACERTO DO FECHAMENTO (2026-08-26), em porcentagem (ex: 80).
   *
   * `percentualCaixinha`: quanto da caixinha declarada fica com ele.
   * `percentualDescontoAbsorvido`: quanto do desconto que ele concede sai da
   * comissão dele.
   *
   * Editáveis pelo admin em `PUT /barbeiros/:id/acerto`. Antes eram derivados
   * (100% cravado e a fração da comissão de serviço); viraram campos porque são
   * negociações diferentes da comissão do corte.
   */
  percentualCaixinha: number;
  percentualDescontoAbsorvido: number;
  /**
   * Foto de perfil (2026-08-19) — URL pública, ou `null`. Sem foto, a UI usa
   * o avatar de iniciais que já existe; nunca uma imagem quebrada.
   */
  fotoUrl: string | null;
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
  /**
   * Comanda editável (2026-08-25): preço CHEIO do barbeiro, antes do desconto
   * progressivo. `null` em itens anteriores à mudança. Serve para a comanda
   * mostrar "de R$40 por R$30" em vez de só o valor final — sem isso o barbeiro
   * não tem como explicar ao cliente de onde saiu o número.
   */
  precoCheioCentavos: number | null;
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
  /**
   * Comanda editável (2026-08-25): desconto progressivo já embutido nos itens
   * avulsos — Σ(precoCheio − valorCobrado). Só existe para exibição; o valor que
   * vale é sempre `valorCobradoCentavos` de cada item.
   */
  descontoProgressivoCentavos: number;
  /**
   * `false` quando a comanda tem dinheiro já recebido (pago online ou saldo
   * residual abatido) e por isso não aceita remoção de item — estorno não existe
   * neste sistema (DECISOES_PENDENTES #55). O painel esconde os botões de
   * remover em vez de deixar o barbeiro descobrir no erro.
   */
  podeEditarComanda: boolean;
  /** Por que não pode — texto pronto para a tela. `null` quando pode. */
  motivoBloqueioEdicao: string | null;
  /**
   * FASE 3 (2026-08-25) — ajustes DECLARADOS no fechamento, em centavos.
   * Zero enquanto o atendimento não foi concluído (ou se nada foi declarado).
   * O efeito no dinheiro está no ledger; aqui é o registro do que foi declarado.
   */
  caixinhaCentavos: number;
  descontoConcedidoCentavos: number;
  /**
   * FASE 4 (2026-08-25) — preenchido quando este atendimento voltou de um
   * cancelamento. `motivoCancelamento` continua preenchido junto: os dois
   * contam a história (foi cancelado por isto, e fulano trouxe de volta).
   */
  reativado: { porNome: string; em: string } | null;
  /**
   * Troca de barbeiro (2026-08-27) — preenchido quando este atendimento mudou
   * de mãos, seja pela reatribuição antes de concluir, seja pela correção com
   * estorno depois. `deNome` é com quem o CLIENTE marcou, mesmo depois de várias
   * trocas: é a pergunta que o rastro responde.
   */
  reatribuido: { deNome: string; porNome: string; em: string } | null;
  /**
   * Registro de que este atendimento foi concluído ANTES do horário marcado
   * (2026-08-20). Preenchido enquanto o status é `CONCLUSAO_PENDENTE` **e
   * depois de aprovado** — é o rastro auditável de por que a conclusão saiu
   * fora de hora. Só a recusa limpa (o pedido não vingou).
   */
  conclusaoAntecipada: {
    motivo: string;
    solicitadaPorNome: string;
    solicitadaEm: string;
  } | null;
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
  /**
   * Créditos consumidos NESTA visita (2026-08-21). Vários créditos do MESMO
   * pacote formam UM atendimento, com o mesmo barbeiro, no mesmo horário — o
   * bloco na agenda é a SOMA das durações. Um pacote "2 cortes + 2 barbas"
   * atende corte+barba numa visita só, em vez de exigir dois agendamentos.
   *
   * Cada crédito continua individual por baixo: seu `valorRateado` congelado,
   * seu lançamento de comissão, seu serviço. Agendar junto é experiência, não
   * um "item combo".
   */
  itemIds: string[];
  /**
   * ⚠️ DEPRECADO em 2026-08-21 — use `itemIds`. Continua aceito porque a API
   * sobe antes dos frontends: durante a janela de deploy, o app publicado ainda
   * manda este campo. Ignorado quando `itemIds` vem preenchido.
   */
  itemId?: string;
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
/**
 * Ponte de pagamento manual por WhatsApp — TEMPORÁRIO (2026-08-18), enquanto o
 * AbacatePay não libera produção. Presente no lugar de `cobranca` quando
 * `PAGAMENTO_MANUAL_WHATSAPP=true`: o funil manda o cliente pro WhatsApp com a
 * comanda pronta e mostra "aguardando confirmação" em vez do QR.
 */
export interface PagamentoManualDTO {
  /** A mesma intenção que o admin vai confirmar depois. */
  intencaoId: string;
  /** Link `wa.me` com a comanda já no texto — o funil só abre. */
  whatsappUrl: string;
  /** O texto da comanda (para exibir/copiar, se o link falhar). */
  comanda: string;
  /** Prazo da reserva/intenção (ISO) — o horário expira igual ao fluxo com PIX. */
  expiraEm: string | null;
}

export interface CobrancaDTO {
  intencaoId: string;
  qrCode: string;
  copiaECola: string;
  /** Prazo da reserva/intenção (ISO) — sessão de OTP+reserva, front mostra contagem regressiva. */
  expiraEm: string;
}

/**
 * O cliente escolheu CARTÃO: não existe QR, e **nenhuma order existe no gateway
 * ainda**. Ela nasce no `POST /public/pagamentos/:intencaoId/cartao`, uma por
 * tentativa.
 *
 * ★ Por que não criar a order junto com a intenção, como o PIX faz: uma order de
 * PIX e uma de cartão vivas para a mesma intenção seriam DOIS caminhos de
 * pagamento abertos ao mesmo tempo — o cliente poderia pagar o PIX e ter o cartão
 * aprovado, e a trava de "uma tentativa viva por vez" só cobre cartão. Escolher o
 * trilho ANTES de cobrar fecha isso sem nenhuma trava nova.
 */
export interface CheckoutCartaoDTO {
  intencaoId: string;
  /**
   * Fim da janela de pagamento (ISO). ★ NÃO renova entre tentativas de cartão:
   * quem gastou 10 dos 30 minutos tem 20.
   */
  expiraEm: string;
}

export interface AgendarResponse {
  atendimentoId: string;
  cobranca: CobrancaDTO | null;
  /** Modo manual (§ PagamentoManualDTO): vem no lugar de `cobranca`. */
  pagamentoManual?: PagamentoManualDTO | null;
}

// ---------- Pacotes ----------
export interface ItemDoPacoteDTO {
  id: string;
  servicoId: string;
  servicoNome: string;
  /**
   * Duração do serviço deste crédito (2026-08-21). A conta do cliente precisa
   * disto pra somar o bloco da visita quando ele junta vários créditos — é a
   * MESMA soma que o domínio faz ao agendar, mostrada antes de confirmar.
   */
  servicoDuracaoMinutos: number;
  valorRateadoCentavos: number;
  status: StatusItemPacote;
  faltasComputadas: number;
  prazoReagendamentoAte: string | null;
  atendimentoId: string | null;
  /**
   * Início do atendimento que usou (ou vai usar) este crédito — ISO 8601 UTC
   * (2026-08-26). `null` enquanto o crédito não está amarrado a nenhum.
   *
   * Existe porque a conta do cliente precisa dizer QUANDO: no crédito agendado,
   * a data completa e não só a hora solta; no consumido, o dia em que ele foi
   * usado, que antes simplesmente não aparecia (o mapa da tela só tinha os
   * agendamentos FUTUROS, e um crédito consumido nunca está lá).
   */
  atendimentoInicio: string | null;
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
  /**
   * Nome da oferta que originou a compra, em SNAPSHOT (2026-08-26) — "Combo 4
   * Cortes Simples". `null` nas vendas anteriores à mudança que o backfill por
   * composição não conseguiu identificar com segurança, e nas vendas avulsas
   * feitas pelo painel (que não partem de oferta nenhuma). Nesse caso a tela
   * deriva um rótulo da composição.
   */
  nomeOferta: string | null;
  /**
   * SNAPSHOT dos dias em que estes créditos valem (2026-08-28) — 0=domingo …
   * 6=sábado, os sete = sem restrição. É o que o cliente COMPROU: a oferta pode
   * ter mudado depois, e a conta dele não muda por causa disso.
   *
   * A frase é derivada na tela (`descricaoDosDias`), nunca trafegada pronta.
   */
  diasPermitidos: number[];
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
  /**
   * Quando o admin deu por devolvido. É o ato ADMINISTRATIVO — no fluxo manual, o
   * dinheiro voltou por fora do sistema e alguém registrou isso aqui.
   */
  reembolsadaEm: string | null;

  // ── Estorno agendado (2026-08-27) ──────────────────────────────────────────
  /**
   * Quando a execução pelo gateway deve acontecer. `null` = ainda não agendado,
   * ou é um reembolso manual (sem pagamento online por trás).
   */
  agendadaPara: string | null;
  /** Quando o GATEWAY confirmou a devolução. Distinto de `reembolsadaEm`. */
  executadaEm: string | null;
  /** Quantas vezes a execução foi tentada e falhou. */
  tentativas: number;
  /**
   * Mensagem CRUA do gateway na última falha. **Admin-only.**
   *
   * Nunca vai para o cliente: pode conter nome de conta, id interno e vocabulário
   * do gateway. A tela do admin traduz com `motivoOperacionalDoEstorno`.
   */
  ultimoErro: string | null;
  /**
   * Este reembolso pode ser executado PELO GATEWAY?
   *
   * `false` quando o pacote foi pago presencialmente (dinheiro, maquininha) ou
   * por um gateway sem estorno: não há transação online para devolver, e o
   * caminho é o manual de sempre — o admin devolve e registra. Agendar aqui não
   * teria o que executar, e a tela precisa saber disso para não oferecer o botão.
   */
  estornoAutomatico: boolean;
}

/**
 * Motivos de falha de um estorno agendado, em linguagem de OPERAÇÃO.
 *
 * O `ultimoErro` é texto cru do gateway, em inglês, com vocabulário de API. Quem
 * lê a tela é o dono da barbearia, e a diferença entre "saldo insuficiente" (ele
 * precisa deixar dinheiro na conta) e "prazo de estorno vencido" (não tem mais
 * jeito por essa via) muda completamente o que ele faz a seguir.
 *
 * Mora em `contracts` porque é a MESMA classificação que o admin renderiza e que
 * a API usa para decidir se vale retentar — duas implementações divergiriam
 * exatamente no caso que importa.
 */
export enum MotivoDaFalhaDeEstorno {
  /**
   * Não havia saldo na conta do gateway no momento da execução. É o motivo mais
   * provável, e o único que o dono resolve sozinho: a documentação do Mercado
   * Pago exige saldo disponível, e a operação saca o saldo para pagar barbeiro.
   */
  SALDO_INSUFICIENTE = 'SALDO_INSUFICIENTE',
  /** O prazo de estorno do meio de pagamento passou (crédito 180d, PIX 90d). */
  PRAZO_VENCIDO = 'PRAZO_VENCIDO',
  /** Gateway fora do ar, timeout, 5xx. Retentar resolve. */
  INDISPONIVEL = 'INDISPONIVEL',
  /** Qualquer outro. Precisa de olho humano no `ultimoErro` cru. */
  DESCONHECIDO = 'DESCONHECIDO',
}

/**
 * Classifica o erro cru do gateway. Pura, sem I/O.
 *
 * O default é `DESCONHECIDO` e NÃO `INDISPONIVEL`: tratar erro novo como
 * "retentar resolve" faria o job bater no gateway para sempre por um motivo que
 * nunca vai passar. Desconhecido pede um humano — que é a resposta honesta.
 */
export function motivoOperacionalDoEstorno(ultimoErro: string | null): MotivoDaFalhaDeEstorno {
  const e = (ultimoErro ?? '').toLowerCase();
  if (!e) return MotivoDaFalhaDeEstorno.DESCONHECIDO;
  if (/insufficient|saldo|balance|funds/.test(e)) return MotivoDaFalhaDeEstorno.SALDO_INSUFICIENTE;
  // `[ _]` porque o gateway alterna entre `not_refundable` (código) e "not
  // refundable" (mensagem) para o MESMO motivo, e um espaço literal deixaria
  // metade dos casos cair em DESCONHECIDO.
  if (/expired|deadline|too old|prazo|not[ _]refundable|period/.test(e)) {
    return MotivoDaFalhaDeEstorno.PRAZO_VENCIDO;
  }
  if (/timeout|unavailable|503|502|504|econn|network|internal_error/.test(e)) {
    return MotivoDaFalhaDeEstorno.INDISPONIVEL;
  }
  return MotivoDaFalhaDeEstorno.DESCONHECIDO;
}

/**
 * O motivo da falha em UMA LINHA, para o dono ler.
 *
 * Mora aqui junto do classificador porque o par (classificar, nomear) só é útil
 * completo: a home mostra o rótulo, a tela de reembolsos mostra o rótulo E o erro
 * cru. Deixar o texto só no front faria a home e a tela dizerem coisas diferentes
 * sobre a mesma falha.
 *
 * Cada texto diz o que FAZER, não o que aconteceu — é a diferença entre o dono
 * resolver sozinho e ele abrir um chamado.
 */
export function rotuloDoMotivoDeEstorno(motivo: MotivoDaFalhaDeEstorno): string {
  switch (motivo) {
    case MotivoDaFalhaDeEstorno.SALDO_INSUFICIENTE:
      return 'Sem saldo na conta do gateway — deixe o valor disponível e tente de novo';
    case MotivoDaFalhaDeEstorno.PRAZO_VENCIDO:
      return 'Prazo de estorno vencido — devolva por fora e registre aqui';
    case MotivoDaFalhaDeEstorno.INDISPONIVEL:
      return 'O gateway não respondeu — tente de novo em alguns minutos';
    case MotivoDaFalhaDeEstorno.DESCONHECIDO:
      return 'Falha não reconhecida — veja o detalhe técnico abaixo';
  }
}

/** Corpo de `POST /pacotes/reembolsos/:id/agendar`. */
export interface AgendarReembolsoRequest {
  /**
   * Em quantos dias executar. Ausente = o padrão do deploy
   * (`REEMBOLSO_PRAZO_DIAS`, 31). **`0` = agora**, e é assim que "antecipar" e
   * "executar imediato" são expressos — sem endpoint próprio para cada um.
   */
  prazoDias?: number;
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
  /**
   * Correção de barbeiro (2026-08-27): qual lançamento este estorno anula.
   * `null` em tudo que não é estorno — que são quase todos. Serve para a tela
   * mostrar o percurso (lançou para A → estornou de A → lançou para B) e para
   * conferência de auditoria.
   */
  estornoDeId: string | null;
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

// ---------- Home (primeira tela do admin) ----------
// Projeção de LEITURA: cada número vem da mesma fonte que a seção detalhada
// correspondente. Um número da home que diverge da seção é bug, não
// arredondamento — por isso nada aqui recalcula dinheiro, com a única exceção
// do ticket médio (agregação documentada em `ticket-medio.ts`).

/** Uma linha de agendamento na home — o mínimo pra reconhecer o compromisso. */
export interface HomeAgendamentoDTO {
  atendimentoId: string;
  /** Instante UTC (ISO) — renderizar no fuso da empresa. */
  inicio: string;
  clienteNome: string;
  barbeiroNome: string;
  servicos: string;
  valorTotalCentavos: number;
  status: StatusAtendimento;
}

/** Uma linha do extrato financeiro na home (comissão ou pagamento recebido). */
export interface HomeLancamentoDTO {
  id: string;
  tipo: TipoLancamento;
  /** Instante UTC (ISO). */
  ocorridoEm: string;
  valorCentavos: number;
  /** O que originou: nome do serviço/produto, ou quem registrou o pagamento. */
  descricao: string;
}

/** Home do BARBEIRO não-admin: só o que é dele. */
export interface HomePessoalDTO {
  barbeiroId: string;
  nome: string;
  fotoUrl: string | null;
  /** Próximos 2 agendamentos DELE (AGENDADO, do agora em diante). */
  proximosAgendamentos: HomeAgendamentoDTO[];
  /**
   * O MESMO número de `ExtratoComissaoDTO.saldoRealCentavos` — lido do mesmo
   * serviço, nunca recalculado aqui. Pode ser negativo (deve à casa).
   */
  saldoRealCentavos: number;
  /** Últimos 2 lançamentos de COMISSÃO dele. */
  ultimasComissoes: HomeLancamentoDTO[];
  /** Últimos 2 PAGAMENTOS que ele recebeu. */
  ultimosPagamentos: HomeLancamentoDTO[];
}

/** Uma pendência esperando decisão do admin. */
export interface HomePendenciaDTO {
  tipo:
    | 'PACOTE_AGUARDANDO'
    | 'ATENDIMENTO_AGUARDANDO_PAGAMENTO'
    | 'CONCLUSAO_ANTECIPADA'
    /**
     * Estorno agendado que esgotou as tentativas (2026-08-27).
     *
     * ★ Entra na home pelo mesmo motivo da conclusão antecipada: se o admin não
     * vê, a trava não protege nada. Aqui é pior — é dinheiro de cliente que NÃO
     * voltou, e quem descobriria primeiro seria ele. Depender de alguém lembrar
     * de abrir a aba "Falhados" é exatamente o silêncio que `followup.md` #1
     * existia para evitar.
     */
    | 'ESTORNO_FALHADO';
  id: string;
  clienteNome: string;
  valorCentavos: number;
  /** Só em CONCLUSAO_ANTECIPADA: quem pediu, e por quê. */
  barbeiroNome?: string;
  /**
   * CONCLUSAO_ANTECIPADA: a justificativa do barbeiro.
   * ESTORNO_FALHADO: o motivo em linguagem de operação (ver
   * `motivoOperacionalDoEstorno`) — nunca o erro cru do gateway, que é longo e
   * em inglês. O cru fica na tela de reembolsos.
   */
  motivo?: string;
  /** Instante UTC (ISO) do fato que gerou a pendência. */
  desde: string;
}

/** Home do ADMIN: gestão da casa, todos os barbeiros. */
export interface HomeGestaoDTO {
  nome: string;
  fotoUrl: string | null;
  /** Dia civil local a que "hoje" se refere (YYYY-MM-DD), no fuso da empresa. */
  hoje: string;
  agendamentosDeHoje: HomeAgendamentoDTO[];
  totalAgendamentosDeHoje: number;
  /**
   * Faturamento do dia: atendimentos CONCLUÍDOS hoje (serviços + produtos, pelo
   * valor cobrado congelado) + vendas avulsas de produto de hoje.
   * NÃO inclui venda de pacote — o pacote entra no faturamento quando o crédito
   * é consumido, para não contar o mesmo dinheiro duas vezes.
   */
  faturamentoDeHojeCentavos: number;
  concluidosHoje: number;
  pendencias: HomePendenciaDTO[];
  /** Mesma regra do faturamento, no mês corrente ÷ concluídos do mês. `null` = sem movimento. */
  ticketMedioCentavos: number | null;
  /** Mês civil local a que o ticket se refere (YYYY-MM). */
  mesDoTicket: string;
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
  /**
   * Comissão de PRODUTO em porcentagem (2026-08-19, decisão dos sócios): taxa
   * ÚNICA da empresa, para todo produto e todo barbeiro. Não é por barbeiro nem
   * por produto — produto é revenda, e a margem não comporta a taxa de serviço.
   * Incide sobre o preço de VENDA (o sistema não cadastra custo de produto).
   */
  comissaoProdutos: number;
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
  /**
   * TEMPORÁRIO (2026-08-18): quando true, "pagar agora" leva o cliente ao
   * WhatsApp da barbearia em vez de gerar PIX. O funil usa só para ajustar o
   * texto do botão — quem decide de fato é o backend.
   */
  pagamentoManualWhatsapp?: boolean;
  /** O que o checkout online deste deploy aceita (2026-08-27). */
  pagamentoOnline: PagamentoOnlineDTO;
  /**
   * WhatsApp da barbearia em E.164 sem `+` (ex.: `5511990036469`), para montar
   * `https://wa.me/<numero>`. `null` quando não configurado — e aí a tela **não
   * mostra o botão**, em vez de mostrar um link quebrado.
   *
   * Servido pela API, e não hardcoded no front, porque duas telas precisam dele
   * (o funil e a conta do cliente) e um número de telefone repetido em dois
   * bundles é a definição de "mesma coisa em dois lugares".
   */
  whatsapp: string | null;
}

/**
 * Capacidades do checkout online, do ponto de vista do funil.
 *
 * O funil usa isto só para DESENHAR a tela (que botões existem, se carrega o SDK
 * do Mercado Pago). Quem decide de fato o que é aceito é o backend, na resposta
 * da confirmação — o front nunca escolhe o meio por conta própria.
 */
export interface PagamentoOnlineDTO {
  /** Meios que este deploy aceita. Vazio = sem pagamento online (modo manual). */
  meios: MeioDePagamentoOnline[];
  /**
   * Chave **pública** do Mercado Pago (`APP_USR-…`), usada apenas para tokenizar
   * o cartão no browser.
   *
   * ★ Aqui entra a chave PÚBLICA e mais nada. O `MERCADOPAGO_ACCESS_TOKEN` tem o
   * mesmo prefixo `APP_USR-` e é indistinguível a olho nu — trocar um pelo outro
   * publicaria a credencial de servidor em toda resposta de `/public/empresa`.
   * `config-seguranca.ts` recusa o boot se as duas forem iguais, e
   * `empresa-publica-query.service.spec.ts` tem um teste-cadeado sobre este campo.
   */
  mercadoPagoPublicKey: string | null;
}
export interface BarbeiroPublicoDTO {
  id: string;
  nome: string;
  /** Foto de perfil (2026-08-19) — URL pública, ou `null` (cai no avatar de iniciais). */
  fotoUrl: string | null;
}
/**
 * "Este telefone já é cliente da casa?" (2026-08-21). Booleano e só: o NOME
 * nunca vem aqui — ele só aparece depois que o cliente prova posse do telefone
 * pelo OTP. Sem essa regra, qualquer um descobriria o nome por trás de um
 * número só digitando números.
 */
export interface ClienteConhecidoDTO {
  conhecido: boolean;
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
  /** online → cobra agora (PIX ou cartão); presencial (default) → pagar na barbearia. */
  formaPagamento?: FormaPagamentoFunil;
  /**
   * Qual trilho online, quando `formaPagamento = 'online'`. Default `'PIX'` —
   * é o comportamento anterior a 2026-08-27, e clientes antigos do funil que não
   * mandam o campo continuam recebendo QR.
   *
   * ★ Isto NÃO é um campo de dinheiro. Escolher cartão não muda o valor: ele sai
   * da `IntencaoDePagamento` no servidor, nos dois trilhos.
   */
  meioOnline?: MeioDePagamentoOnline;
}
export interface AgendarPublicoResponse {
  atendimentoId: string;
  /** Modo manual (§ PagamentoManualDTO): presente no lugar de `cobranca`. */
  pagamentoManual?: PagamentoManualDTO | null;
  /** intenção de pagamento quando online (para consultar status); null se presencial. */
  intencaoId: string | null;
  /** cobrança PIX quando online e `meioOnline = 'PIX'`; null nos outros casos. */
  cobranca: CobrancaDTO | null;
  /** Presente (no lugar de `cobranca`) quando `meioOnline = 'CARTAO_CREDITO'`. */
  checkoutCartao?: CheckoutCartaoDTO | null;
  /**
   * Barbeiro que vai atender. Sempre presente — inclusive (e principalmente)
   * quando o cliente escolheu "não tenho preferência" e a atribuição foi do
   * servidor: ele precisa saber com quem ficou.
   *
   * `fotoUrl` (2026-08-21) porque a tela de sucesso mostra rosto e nome. No
   * "sem preferência" é o único lugar de onde a foto pode vir: o funil nunca
   * escolheu esse barbeiro, então não tem a foto guardada.
   */
  barbeiro: { id: string; nome: string; fotoUrl: string | null };
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
  /**
   * Foto do item (2026-08-19) — só produto tem; serviço vem `null`. Sem foto,
   * a vitrine mostra um placeholder, nunca imagem quebrada.
   */
  fotoUrl: string | null;
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
/**
 * O que o cadastro do cliente JÁ tem preenchido (2026-08-21) — lido com sessão,
 * depois que a identidade foi provada. É o que o funil usa pra perguntar só o
 * que falta.
 *
 * `nome: null` significa "ainda não tem nome de verdade": o `Cliente` nasceu de
 * um login por OTP e está com o placeholder. A API não devolve o placeholder
 * como se fosse nome — devolver "Cliente" faria o funil achar que já sabe o
 * nome, pular o campo, e cristalizar o placeholder pra sempre. Foi exatamente
 * esse o bug de 2026-08-21.
 */
export interface CadastroDoClienteDTO {
  nome: string | null;
  email: string | null;
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
/** Estado do cliente no Bigod's Club (2026-08-21) — calculado, nunca armazenado. */
export interface ClubeDoClienteDTO {
  status: StatusDoClube;
  /**
   * Quando entrou no status atual (ISO), do log de eventos. `null` quando nunca
   * houve transição registrada — cliente que nunca teve pacote, ou pacote
   * anterior ao log existir. A UI não depende disto pra decidir nada; é texto.
   */
  desde: string | null;
  /**
   * Créditos vivos agora: DISPONIVEL, SEGUNDA_CHANCE ou AGENDADO, em pacote
   * PAGO. Zero é o que caracteriza o inativo.
   */
  creditosVivos: number;
}
export interface PerfilClienteDTO {
  cliente: ClienteSessaoDTO;
  /** Pacotes do cliente (reusa o read model de pacotes). */
  pacotes: VendaDePacoteDTO[];
  /** Estado no Bigod's Club — decide o tema visual e o convite/incentivo. */
  clube: ClubeDoClienteDTO;
  /**
   * O que ainda vai acontecer, do mais próximo ao mais distante: AGENDADO,
   * CONCLUSAO_PENDENTE e RESERVADO (reserva de avulso online cujo prazo de
   * pagamento não venceu — o front usa `status` pra dizer "aguardando
   * confirmação"). Nada daqui aparece no histórico, e vice-versa.
   */
  proximosAgendamentos: AgendamentoClienteDTO[];
  /**
   * Reembolsos que o cliente pediu e ainda estão vivos, ou foram concluídos há
   * pouco. Ele pede pelo cockpit e, até 2026-08-27, nunca mais via nada — a
   * ansiedade de "cadê meu dinheiro" virava mensagem no WhatsApp da barbearia.
   */
  reembolsos: ReembolsoDoClienteDTO[];
  /**
   * Pagamentos que chegaram DEPOIS da janela de 30 min e foram devolvidos
   * automaticamente. O cliente pagou e perdeu o horário — precisa saber, e
   * precisa de um caminho para remarcar.
   */
  estornosAutomaticos: EstornoAutomaticoDTO[];
}

/**
 * Um reembolso, do ponto de vista do CLIENTE.
 *
 * ## O que este DTO deliberadamente NÃO tem
 *
 * `ultimoErro`, `tentativas` e `gatewayRefundId`. Nenhum dos três é problema do
 * cliente, e o primeiro é texto cru de gateway em inglês — mostrá-lo transformaria
 * "estamos concluindo sua devolução" em "insufficient_funds", que o cliente leria
 * como "a barbearia não tem dinheiro". O detalhe fica no admin.
 *
 * Também não há ação nenhuma aqui: o cliente **não** cancela nem antecipa
 * reembolso (decisão do dono). A ação dele é o WhatsApp.
 */
export interface ReembolsoDoClienteDTO {
  id: string;
  valorCentavos: number;
  status: StatusSolicitacaoReembolso;
  criadaEm: string;
  /**
   * Quando a devolução está programada. ★ Vai como DATA, e a tela mostra a data
   * — nunca "em breve". Quem espera dinheiro quer saber o dia.
   */
  agendadaPara: string | null;
  /** Quando voltou de fato. */
  reembolsadaEm: string | null;
  /**
   * Por onde o dinheiro volta. Muda o TEXTO e a expectativa: crédito volta **na
   * fatura** do cartão (e pode aparecer só no mês seguinte), PIX cai na conta.
   * Dizer "vai cair na sua conta" para quem pagou no crédito gera exatamente a
   * mensagem de "não caiu" que o texto certo evitaria.
   *
   * `null` = pago no balcão, ou linha anterior à coluna `meio`.
   */
  meio: MeioDePagamentoOnline | null;
}

/**
 * Pagamento que chegou depois da janela e foi devolvido automaticamente.
 *
 * O cliente pagou, o dinheiro voltou, e o horário **não é dele**. Isso não pode
 * ser um aviso passivo: a tela precisa oferecer remarcar, com o serviço já
 * escolhido.
 */
export interface EstornoAutomaticoDTO {
  intencaoId: string;
  valorCentavos: number;
  /** Quando o estorno foi solicitado ao gateway. */
  estornadoEm: string;
  /** Para o CTA de remarcar já vir com o serviço certo. `null` se não der para saber. */
  servicoId: string | null;
  servicoNome: string | null;
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
  /**
   * Dias da semana em que os créditos deste pacote podem ser usados
   * (2026-08-28) — 0=domingo … 6=sábado, os sete = sem restrição.
   *
   * ★ A FRASE que o cliente lê ("Válido de segunda a quinta") NÃO trafega: cada
   * tela deriva a dela com `descricaoDosDias` deste mesmo pacote de contracts.
   * Mandar o texto pronto abriria a porta para ele divergir dos dias reais —
   * e é justamente o texto que o cliente usa para decidir a compra.
   */
  diasPermitidos: number[];
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
  /** Omitido ou vazio = todos os dias (2026-08-28). */
  diasPermitidos?: number[];
}
export interface AtualizarPacoteOfertaRequest {
  nome: string;
  composicao: ItemComposicaoPacoteRequest[];
  precoCentavos: number;
  /** Omitido ou vazio = todos os dias (2026-08-28). */
  diasPermitidos?: number[];
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
  /**
   * Trilho online escolhido. Default `'PIX'` — pacote é sempre online (decisão do
   * dono), o que muda aqui é só como o cliente paga.
   */
  meioOnline?: MeioDePagamentoOnline;
}
export interface VenderPacotePublicoResponse {
  vendaId: string;
  clienteId: string;
  /** Modo manual (§ PagamentoManualDTO): presente no lugar de `cobranca`. */
  pagamentoManual?: PagamentoManualDTO | null;
  /** intenção de pagamento — sempre presente (para consultar status / reconciliar). */
  intencaoId: string;
  /**
   * Cobrança PIX. Pagamento online é obrigatório no pacote, então vem
   * preenchida — EXCETO no modo de pagamento manual (onde `pagamentoManual`
   * toma o lugar dela) e no cartão (onde é `checkoutCartao`).
   */
  cobranca: CobrancaDTO | null;
  /** Presente (no lugar de `cobranca`) quando `meioOnline = 'CARTAO_CREDITO'`. */
  checkoutCartao?: CheckoutCartaoDTO | null;
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
  /** Foto do produto (2026-08-19) — URL pública, ou `null` (a UI mostra placeholder). */
  fotoUrl: string | null;
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

// ---------- Webhook Mercado Pago (Orders API, tópico `order`) ----------
// Formato transcrito da documentação oficial (checkout-api-orders/notifications).
//
// ★ Este payload é um PING, e é aí que ele difere em NATUREZA do da AbacatePay:
// `data` tem UM único campo (`id`, o id da order — `ORD01…`), e o corpo NÃO traz
// status, NÃO traz valor e NÃO traz o nosso `external_reference`. Saber o que
// aconteceu exige um `GET /v1/orders/{id}` — a própria doc manda fazer isso
// depois de responder.
//
// O mesmo id também vem nos query params (`?data.id=…&type=order`), e é a versão
// do QUERY que entra no manifesto da assinatura.
//
// Payload deliberadamente frouxo (campos extras tolerados), mesma disciplina do
// webhook da AbacatePay: validar contra schema rígido quebraria com qualquer
// campo novo que o Mercado Pago acrescente.
export interface WebhookMercadoPagoRequest {
  /** Ex.: "order.created", "order.updated", "order.action_required". */
  action?: string;
  api_version?: string;
  /** Conferido contra MERCADOPAGO_APPLICATION_ID — pega URL cruzada entre ambientes. */
  application_id?: string | number;
  date_created?: string;
  /** id do EVENTO (idempotência do lado deles), não da order. */
  id?: string | number;
  /** false em teste, true em produção. Conferido contra MERCADOPAGO_ENV. */
  live_mode?: boolean;
  /** "order" para o tópico que nos interessa. */
  type?: string;
  /** id do vendedor. */
  user_id?: string | number;
  data?: {
    /** id da ORDER (`ORD01…`) — a única chave que a notificação entrega. */
    id?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ---------- Pagamento com cartão de crédito (Mercado Pago, Orders API) ----------

/**
 * Corpo de `POST /public/pagamentos/:intencaoId/cartao`.
 *
 * ★ Note o que NÃO existe aqui: **nenhum campo de dinheiro**. O valor vem da
 * `IntencaoDePagamento` já persistida no servidor. A ausência do campo é a
 * proteção contra "assinar um valor e pagar outro" — o `whitelist` do
 * ValidationPipe descarta o que não está no DTO, mas quem garante é a ausência.
 *
 * `installments` também não existe: à vista é constante do adapter.
 */
export interface PagarComCartaoRequest {
  companyId: string;
  /** Token gerado no BROWSER pelo MercadoPago.js. O PAN nunca chega ao backend. */
  token: string;
  /** Bandeira (`master`, `visa`, `elo`…), que o SDK deduz do BIN. */
  paymentMethodId: string;
  /** `MP_DEVICE_SESSION_ID` do antifraude, se o SDK o coletou. */
  deviceId?: string;
}

export interface PagarComCartaoResponse {
  intencaoId: string;
  resultado: ResultadoDoCartao;
  /**
   * Só em `RECUSADO`. Enum pequeno e vago de propósito — o `status_detail` cru do
   * gateway nunca sai daqui (ver `MotivoPublicoDaRecusa`).
   */
  motivoPublico?: MotivoPublicoDaRecusa;
  /** Só em `DESAFIO_3DS`: abrir num iframe. O comprador tem 40 minutos. */
  urlDoDesafio3ds?: string;
  /**
   * O cliente pode tentar outro cartão? A janela de 30 min NÃO é renovada em
   * nenhum caso — quem gastou 10 minutos tem 20.
   */
  podeTentarNovamente: boolean;
  /** Fim da janela de pagamento, inalterado por esta tentativa. */
  expiraEm: string | null;
}
