import { precificarCarrinhoDoFunil } from '@bigods/contracts';
import type {
  BarbeiroPublicoDTO,
  ItemDeOrderBumpDTO,
  MeioDePagamentoOnline,
  OrderBumpDTO,
  ProdutoBumpRequest,
  ServicoDTO,
  TabelaDeDescontoDTO,
} from '@bigods/contracts';

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
  /**
   * Foto do barbeiro escolhido (2026-08-21) — snapshot, igual ao nome: o
   * cliente vê rosto e nome de quem escolheu na faixa do funil, na confirmação
   * e no sucesso. `null` = sem foto, e o avatar cai nas iniciais.
   */
  barbeiroFotoUrl: string | null;
  /**
   * Reorganização do passo de dados (2026-08-21). O cliente informa o TELEFONE
   * primeiro; só depois o funil sabe o que perguntar:
   *
   * - `null`  → ainda não perguntamos. Só o campo de telefone aparece.
   * - `true`  → já é cliente da casa E confirmou identidade por OTP. O nome vem
   *             do cadastro; o funil não pergunta de novo e não sobrescreve.
   * - `false` → não tem cadastro. Aí sim aparecem nome e os opcionais.
   *
   * Trocar o telefone volta pra `null`: a resposta era sobre o outro número.
   */
  clienteConhecido: boolean | null;
  /**
   * ★ CONTINGÊNCIA DE OTP (2026-09-04): existe conta para este telefone, mas
   * NÃO há como provar agora que é dela quem está agendando — conta antiga, de
   * antes da senha, e o código de confirmação não chega.
   *
   * O funil segue (o horário é agendado, pendente de aprovação como todos os
   * outros da contingência), mas se comporta como se não soubesse quem é: não
   * mostra o nome do cadastro — mostrá-lo transformaria o campo de telefone
   * numa consulta de "quem é o dono deste número" — e também não pergunta o
   * nome, para não mandar de volta um que sobrescreva o cadastro real.
   *
   * NUNCA vira "crie sua senha aqui": sem prova de posse do telefone, isso
   * entregaria a conta (com histórico, pacotes e créditos pagos) a quem
   * chegasse primeiro. Quem destrava é o admin, à mão.
   */
  contaSemAcesso: boolean;
  /**
   * O cadastro já tem e-mail (2026-08-21). Aí o funil não pergunta — e não
   * manda nada, então não sobrescreve. Mesma política do nome.
   */
  emailJaCadastrado: boolean;
  /** true quando o barbeiro foi pré-selecionado por ser o único da casa. */
  barbeiroAuto: boolean;
  /** true quando o barbeiro veio do link pessoal dele (§4b) — mostra "Agendando com X" e a saída "ver outros profissionais". */
  barbeiroFixadoPorLink: boolean;
  /**
   * "Não tenho preferência": distingue "ainda não escolheu" (barbeiroId null e
   * este false) de "escolheu não escolher" (barbeiroId null e este true). Com
   * ele ligado, o funil pede horários GLOBAIS e o servidor atribui o barbeiro
   * na confirmação.
   */
  semPreferencia: boolean;
  /**
   * Valor realmente cobrado, devolvido pela API na confirmação. Só ele é
   * confiável quando houve "sem preferência" — antes disso o funil mostra
   * "a partir de", porque preço é por barbeiro.
   */
  valorFinalCentavos: number | null;
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
  /**
   * Trilho online escolhido: PIX (default) ou cartão de crédito.
   *
   * ★ É a ÚNICA coisa do cartão que mora aqui — e mora porque não é dado de
   * cartão, é uma escolha de tela, do mesmo tipo que `formaPagamento`. Número,
   * validade, CVV, nome do titular e CPF **nunca** entram no `FunnelState`: este
   * objeto é serializado inteiro em `sessionStorage` (ver `salvarEstado`), e o
   * scrubbing do Sentry não alcança o disco do celular do cliente. Número e CVV
   * nem existem no nosso JavaScript — vivem em iframes do Mercado Pago.
   *
   * `funnel-state.spec.ts` tem um teste-cadeado com a lista congelada de chaves,
   * e `contemNumeroDeCartao` abaixo é a segunda linha de defesa em runtime.
   */
  meioOnline: MeioDePagamentoOnline;
  /** Compra/agendamento concluído nesta sessão — estado final (§ bug 1). */
  concluido: boolean;
  /**
   * Order-bump (sessão 2026-08-17): produtos escolhidos na confirmação, na
   * seção "Adicione à sua visita". Serviço complementar do bump NÃO tem campo
   * próprio — adicionar um é literalmente adicionar o id a `servicoIds`
   * (mesmo desconto progressivo, mesmo preço por barbeiro; nenhum caminho de
   * preço paralelo). Só existe na trilha avulso — pacote é crédito pré-pago,
   * sem Atendimento para anexar produto.
   */
  produtosBump: ProdutoBumpRequest[];
  /**
   * Quais serviços do carrinho entraram PELO order-bump (Parte 2). Eles também
   * estão em `servicoIds` — são serviços do atendimento como qualquer outro —,
   * mas só quem está aqui paga o preço promocional configurado e sai da escada
   * do desconto progressivo. É esta lista que vai no corpo do agendamento como
   * `servicosBump`, para o backend chegar ao MESMO número.
   */
  servicosBump: string[];
}

export const estadoInicial: FunnelState = {
  step: PASSO.LANDING,
  modo: 'avulso',
  servicoIds: [],
  barbeiroId: null,
  barbeiroNome: null,
  barbeiroFotoUrl: null,
  clienteConhecido: null,
  contaSemAcesso: false,
  emailJaCadastrado: false,
  barbeiroAuto: false,
  barbeiroFixadoPorLink: false,
  semPreferencia: false,
  valorFinalCentavos: null,
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
  meioOnline: 'PIX',
  concluido: false,
  produtosBump: [],
  servicosBump: [],
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
export function aplicarBarbeiroDoLink(
  barbeiroId: string,
  barbeiroNome: string,
  barbeiroFotoUrl: string | null,
): FunnelState {
  return {
    ...estadoInicial,
    barbeiroId,
    barbeiroNome,
    barbeiroFotoUrl,
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

/** Luhn — o dígito verificador que todo cartão de crédito satisfaz. */
function passaLuhn(digitos: string): boolean {
  let soma = 0;
  let dobra = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let n = Number(digitos[i]);
    if (dobra) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
    dobra = !dobra;
  }
  return soma % 10 === 0;
}

/**
 * Alguma coisa neste estado se parece com um número de cartão?
 *
 * ## O que esta função protege
 *
 * `salvarEstado` serializa o `FunnelState` INTEIRO em `sessionStorage`. Se alguém
 * acrescentar `numeroCartao`, `cvv` ou o token do cartão ao estado — por hábito,
 * "só para não perder o formulário no refresh" —, esses dados vão para o disco do
 * celular do cliente. Nem o scrubbing do Sentry nem a CSP alcançam isso: o dado
 * já saiu do nosso controle no momento do `setItem`.
 *
 * ## Por que Luhn, e por que o telefone é exceção
 *
 * A checagem ingênua "existe corrida de 13 a 19 dígitos?" dispara em **todo**
 * estado do funil: um celular brasileiro em E.164 (`5511912345678`) tem
 * exatamente 13 dígitos. Um guarda que acusa sempre é um guarda que se desliga.
 *
 * Então: o campo `telefone` é excluído da varredura (é o único campo do funil
 * cujo conteúdo é legitimamente uma corrida longa de dígitos), e o que sobra só
 * conta como cartão se passar no Luhn. A chance de um id ou preço passar em Luhn
 * por acidente existe, e é aceitável: o custo do falso positivo é perder o
 * progresso salvo de um funil; o do falso negativo é PAN no disco.
 */
export function contemNumeroDeCartao(estado: FunnelState): boolean {
  const { telefone: _telefone, ...resto } = estado;
  const json = JSON.stringify(resto);
  for (const corrida of json.match(/\d{13,19}/g) ?? []) {
    if (passaLuhn(corrida)) return true;
  }
  return false;
}

export function salvarEstado(estado: FunnelState): void {
  // ★ Tripwire, não validação de fluxo: em operação normal nunca dispara. Quando
  // dispara, NÃO persiste — perder o progresso do funil é muito melhor que
  // gravar um cartão no disco do cliente. E grita no console em vez de lançar:
  // um `throw` aqui, dentro de um efeito do React, derrubaria o checkout de um
  // cliente pagante para o error boundary.
  if (contemNumeroDeCartao(estado)) {
    console.error(
      '[bigods] FunnelState contém algo que se parece com número de cartão — ' +
        'estado NÃO persistido. Dado de cartão não pode entrar em funnel-state.ts: ' +
        'ver o comentário de `meioOnline` e o teste-cadeado em funnel-state.spec.ts.',
    );
    return;
  }
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
): { id: string; nome: string; fotoUrl: string | null } | null {
  if (!barbeiros || barbeiros.length !== 1) return null;
  const unico = barbeiros[0]!;
  if (barbeiroIdAtual === unico.id) return null; // já resolvido — evita reaplicar em loop
  return { id: unico.id, nome: unico.nome, fotoUrl: unico.fotoUrl };
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
  /** true quando o preço veio da promoção do bump, não da escada progressiva. */
  promocional: boolean;
}

export interface CarrinhoFunil {
  itens: ItemDoCarrinhoFunil[];
  totalCheioCentavos: number;
  descontoTotalCentavos: number;
  totalFinalCentavos: number;
  temDesconto: boolean;
}

/**
 * Preço do carrinho de avulsos — desconto progressivo E promoção de order-bump.
 *
 * Usa `precificarCarrinhoDoFunil` de `@bigods/contracts` — exatamente a mesma
 * função que a API usa para cobrar. É isso que garante que o número mostrado
 * aqui é o número que vai ser cobrado: um cálculo próprio no front seria uma
 * segunda verdade sobre dinheiro, e a diferença apareceria como cobrança
 * "errada" para o cliente.
 *
 * Os preços já vêm do `/public/servicos` filtrado pelo barbeiro escolhido, ou
 * seja, são a base DAQUELE barbeiro (com override, se houver). `promocionais`
 * mapeia servicoId → preço promocional, vindo já resolvido de
 * `/public/order-bump` (o front nunca calcula promoção a partir de percentual).
 */
export function precificarCarrinhoFunil(
  servicos: ServicoDTO[],
  ids: string[],
  tabela: TabelaDeDescontoDTO,
  promocionais: Map<string, number> = new Map(),
): CarrinhoFunil {
  const selecionados = servicosSelecionados(servicos, ids);
  const calculo = precificarCarrinhoDoFunil(
    selecionados.map((s) => ({
      precoCheioCentavos: s.precoAvulsoCentavos,
      precoPromocionalCentavos: promocionais.get(s.id) ?? null,
    })),
    tabela,
  );
  return {
    itens: selecionados.map((servico, i) => ({
      servico,
      precoCheioCentavos: calculo.itens[i]!.precoCheioCentavos,
      descontoCentavos: calculo.itens[i]!.descontoCentavos,
      precoFinalCentavos: calculo.itens[i]!.precoFinalCentavos,
      promocional: calculo.itens[i]!.promocional,
    })),
    totalCheioCentavos: calculo.totalCheioCentavos,
    descontoTotalCentavos: calculo.descontoTotalCentavos,
    totalFinalCentavos: calculo.totalFinalCentavos,
    temDesconto: calculo.descontoTotalCentavos > 0,
  };
}

/**
 * servicoId → preço promocional, para os serviços que o cliente adicionou PELO
 * bump. Um serviço só ganha promoção se veio do bump E tem oferta configurada
 * (`descontoCentavos > 0`) — sem isso, ele é um item normal do carrinho.
 */
export function promocionaisDoBump(
  bump: OrderBumpDTO | null,
  servicosBump: string[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  if (!bump) return mapa;
  for (const item of bump.servicos) {
    if (servicosBump.includes(item.id) && item.descontoCentavos > 0) {
      mapa.set(item.id, item.precoPromocionalCentavos);
    }
  }
  return mapa;
}

export function duracaoMinutos(servicos: ServicoDTO[], ids: string[]): number {
  return servicosSelecionados(servicos, ids).reduce((acc, s) => acc + s.duracaoMinutos, 0);
}

/**
 * Qual URL de catálogo buscar no passo de serviços — `null` quando ainda não
 * há o que buscar.
 *
 * Existe como função pura porque a decisão tem três casos e já causou bug: com
 * "não tenho preferência" não há `barbeiroId`, e a condição ingênua
 * (`barbeiroId ? busca : lista vazia`) fazia o passo de serviços aparecer
 * VAZIO — o cliente via o Bigod's Club e nada embaixo.
 *
 * - barbeiro escolhido → catálogo com o preço DELE (override aplicado no back);
 * - sem preferência → catálogo com o preço de REFERÊNCIA da casa, que é a base
 *   do "a partir de" (o preço real só existe depois da atribuição);
 * - ainda não decidiu → nada a buscar.
 */
export function urlDoCatalogoDeServicos(
  companyId: string,
  barbeiroId: string | null,
  semPreferencia: boolean,
): string | null {
  const base = `/public/servicos?companyId=${encodeURIComponent(companyId)}`;
  if (barbeiroId) return `${base}&barbeiroId=${barbeiroId}`;
  if (semPreferencia) return base;
  return null;
}

/**
 * URL da vitrine de order-bump ("Adicione à sua visita"). Mesmo padrão de
 * `urlDoCatalogoDeServicos`: com barbeiro, preço já é o dele; sem barbeiro
 * (ainda não escolheu, ou "sem preferência"), preço de referência da casa —
 * a API filtra pela relação `barbeiro.atende`, então nunca sugere o que ele
 * não faz.
 */
export function urlDoOrderBump(companyId: string, barbeiroId: string | null): string {
  const base = `/public/order-bump?companyId=${encodeURIComponent(companyId)}`;
  return barbeiroId ? `${base}&barbeiroId=${barbeiroId}` : base;
}

/**
 * Liga/desliga um produto do order-bump — "adicionar com um toque" (sem
 * seletor de quantidade nesta v1, decisão consciente de manter simples).
 * Segunda batida no mesmo produto remove; quantidade sempre 1.
 */
export function alternarProdutoNoBump(
  atual: ProdutoBumpRequest[],
  produtoId: string,
): ProdutoBumpRequest[] {
  const jaTem = atual.some((p) => p.produtoId === produtoId);
  if (jaTem) return atual.filter((p) => p.produtoId !== produtoId);
  return [...atual, { produtoId, quantidade: 1 }];
}

/**
 * Total (em centavos) dos produtos do bump — sem desconto progressivo, que é
 * regra de SERVIÇO. O preço usado é o PROMOCIONAL já resolvido pela API
 * (`precoPromocionalCentavos`), congelado como snapshot na confirmação.
 */
export function precificarProdutosBump(
  produtos: ItemDeOrderBumpDTO[],
  selecionados: ProdutoBumpRequest[],
): number {
  return selecionados.reduce((acc, sel) => {
    const produto = produtos.find((p) => p.id === sel.produtoId);
    return produto ? acc + produto.precoPromocionalCentavos * sel.quantidade : acc;
  }, 0);
}

/**
 * Serviços da vitrine de bump que ainda fazem sentido oferecer — "filtro
 * óbvio" do spec (sessão 2026-08-17): nunca sugere um serviço complementar
 * que o cliente JÁ colocou no carrinho pela tela normal de serviços.
 *
 * Um serviço adicionado PELO próprio bump continua aparecendo (marcado como
 * escolhido), porque é ali mesmo que o cliente o remove — remover não pode
 * exigir voltar no funil.
 */
export function servicosSugeridosDoBump(
  servicosBump: ItemDeOrderBumpDTO[],
  servicoIdsSelecionados: string[],
  adicionadosPeloBump: string[] = [],
): ItemDeOrderBumpDTO[] {
  return servicosBump.filter(
    (s) => !servicoIdsSelecionados.includes(s.id) || adicionadosPeloBump.includes(s.id),
  );
}

/**
 * Liga/desliga um serviço complementar do bump. Diferente do `toggleServico`
 * da tela de serviços, NÃO zera data/hora: aqui o horário já foi escolhido, e
 * refazer o funil por causa de um complemento é exatamente a fricção que a
 * Parte 2 veio tirar. Devolve as duas listas juntas porque elas precisam andar
 * em par — um id em `servicosBump` que não esteja em `servicoIds` é recusado
 * pelo backend.
 */
export function alternarServicoNoBump(
  servicoIds: string[],
  servicosBump: string[],
  servicoId: string,
): { servicoIds: string[]; servicosBump: string[] } {
  const jaTem = servicosBump.includes(servicoId);
  if (jaTem) {
    return {
      servicoIds: servicoIds.filter((id) => id !== servicoId),
      servicosBump: servicosBump.filter((id) => id !== servicoId),
    };
  }
  return {
    servicoIds: servicoIds.includes(servicoId) ? servicoIds : [...servicoIds, servicoId],
    servicosBump: [...servicosBump, servicoId],
  };
}
