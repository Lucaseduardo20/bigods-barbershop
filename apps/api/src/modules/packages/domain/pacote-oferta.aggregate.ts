import { StatusAprovacaoPacoteOferta, diasNormalizados } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { CompanyId, PacoteOfertaId, ServicoId } from '../../../shared/domain/ids';
import {
  InvarianteVioladaError,
  TransicaoDeEstadoInvalidaError,
} from '../../../shared/errors/domain-error';

export { StatusAprovacaoPacoteOferta };

export interface ItemComposicaoPacote {
  servicoId: ServicoId;
  quantidade: number;
}

export interface PacoteOfertaProps {
  id: PacoteOfertaId;
  companyId: CompanyId;
  nome: string;
  /** Composição MISTA: N serviços distintos, cada um com sua quantidade. */
  composicao: ItemComposicaoPacote[];
  /**
   * Preço do pacote — é a ÚNICA fonte de verdade persistida. O percentual de
   * desconto mostrado ao admin/cliente é sempre DERIVADO deste preço + a soma
   * dos avulsos, nunca armazenado (se o percentual fosse a fonte de verdade,
   * uma mudança futura no preço avulso de referência alteraria o preço do
   * pacote sozinha, sem ninguém ter decidido isso — mesma disciplina de
   * snapshot do resto do sistema).
   */
  preco: Dinheiro;
  /**
   * DIAS DA SEMANA em que os créditos deste pacote podem ser usados
   * (2026-08-28) — 0=domingo … 6=sábado, os sete = sem restrição.
   *
   * Existe porque um pacote econômico não deveria consumir a agenda de sexta e
   * sábado: o preço baixo não se justifica no horário mais disputado da casa.
   *
   * ★ Isto é a regra ATUAL do catálogo, e NÃO alcança pacote já vendido: a
   * `VendaDePacote` congela os dias que valiam no dia da compra (§3.5). Mudar
   * aqui vale só para as próximas vendas.
   */
  diasPermitidos: number[];
  ativo: boolean;
  /** Workflow de aprovação (Fase 3) — só APROVADO aparece no funil público. */
  statusAprovacao: StatusAprovacaoPacoteOferta;
  /** Preenchido só quando REJEITADO. */
  motivoRejeicao: string | null;
}

/**
 * Dados resolvidos pelo CALLER (use case) para validar a oferta — mantém o
 * domínio puro (sem acesso a repositório).
 *
 * `somaAvulsos` é a soma dos preços de REFERÊNCIA DA CASA (`Servico.precoAvulso`)
 * dos serviços da composição. Desde 2026-08-18 a oferta é da empresa, não de um
 * barbeiro: existe UM preço de pacote para todo mundo, então a base de
 * comparação também precisa ser uma só. Override de preço de barbeiro (§3.2.2)
 * não entra aqui — ele vale para avulso, não para o catálogo de pacotes.
 */
export interface ContextoValidacaoPacoteOferta {
  somaAvulsos: Dinheiro;
}

export class PacoteOferta extends AggregateRoot {
  private constructor(private props: PacoteOfertaProps) {
    super();
  }

  /**
   * Admin cria/edita → PENDENTE_APROVACAO por padrão (regra da Fase 3).
   * `RASCUNHO` existe como estado explícito da máquina, mas nada nesta sessão
   * dispara sua criação automaticamente — só é alcançável passando
   * `statusAprovacao: RASCUNHO` explicitamente.
   * DECISAO_PENDENTE: se deveria existir um fluxo de UI "salvar rascunho"
   * separado de "enviar pra aprovação" — não estava especificado.
   */
  static criar(
    props: Omit<PacoteOfertaProps, 'ativo' | 'statusAprovacao' | 'motivoRejeicao' | 'diasPermitidos'> & {
      ativo?: boolean;
      statusAprovacao?: StatusAprovacaoPacoteOferta;
      /** Omitido = todos os dias, que é o comportamento de antes desta regra. */
      diasPermitidos?: number[];
    },
    contexto: ContextoValidacaoPacoteOferta,
  ): PacoteOferta {
    PacoteOferta.validar(props.nome, props.composicao, props.preco, contexto);
    PacoteOferta.validarDias(props.diasPermitidos);
    return new PacoteOferta({
      ...props,
      nome: props.nome.trim(),
      composicao: props.composicao.map((i) => ({ ...i })),
      diasPermitidos: diasNormalizados(props.diasPermitidos),
      ativo: props.ativo ?? true,
      statusAprovacao: props.statusAprovacao ?? StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO,
      motivoRejeicao: null,
    });
  }

  static reconstituir(props: PacoteOfertaProps): PacoteOferta {
    return new PacoteOferta(props);
  }

  /**
   * CRUD de admin/barbeiro é sempre substituição total de nome/composição/preço.
   * Editar um pacote já revisado (APROVADO ou REJEITADO) volta para
   * PENDENTE_APROVACAO — precisa passar pelo admin de novo. Um RASCUNHO ou um
   * já PENDENTE continuam no mesmo estado (editar um rascunho não o publica
   * sozinho; editar um pendente não pula fila).
   */
  atualizar(
    dados: {
      nome: string;
      composicao: ItemComposicaoPacote[];
      preco: Dinheiro;
      diasPermitidos?: number[];
    },
    contexto: ContextoValidacaoPacoteOferta,
  ): void {
    PacoteOferta.validar(dados.nome, dados.composicao, dados.preco, contexto);
    PacoteOferta.validarDias(dados.diasPermitidos);
    this.props.nome = dados.nome.trim();
    this.props.composicao = dados.composicao.map((i) => ({ ...i }));
    this.props.preco = dados.preco;
    this.props.diasPermitidos = diasNormalizados(dados.diasPermitidos);
    if (
      this.props.statusAprovacao === StatusAprovacaoPacoteOferta.APROVADO ||
      this.props.statusAprovacao === StatusAprovacaoPacoteOferta.REJEITADO
    ) {
      this.props.statusAprovacao = StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO;
      this.props.motivoRejeicao = null;
    }
  }

  /** RASCUNHO → PENDENTE_APROVACAO (submeter pra revisão). */
  enviarParaAprovacao(): void {
    if (this.props.statusAprovacao !== StatusAprovacaoPacoteOferta.RASCUNHO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Oferta em ${this.props.statusAprovacao} não pode ser enviada para aprovação`,
      );
    }
    this.props.statusAprovacao = StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO;
  }

  /**
   * Aprova — quem chama (admin) já foi autorizado na borda. Desde 2026-08-18
   * o catálogo de ofertas é da empresa e só admin cadastra, então isto virou
   * na prática o passo "publicar" de um rascunho.
   */
  aprovar(): void {
    if (this.props.statusAprovacao !== StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Oferta em ${this.props.statusAprovacao} não pode ser aprovada`,
      );
    }
    this.props.statusAprovacao = StatusAprovacaoPacoteOferta.APROVADO;
    this.props.motivoRejeicao = null;
  }

  rejeitar(motivo: string): void {
    if (this.props.statusAprovacao !== StatusAprovacaoPacoteOferta.PENDENTE_APROVACAO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Oferta em ${this.props.statusAprovacao} não pode ser rejeitada`,
      );
    }
    if (!motivo.trim()) {
      throw new InvarianteVioladaError('Rejeição exige motivo');
    }
    this.props.statusAprovacao = StatusAprovacaoPacoteOferta.REJEITADO;
    this.props.motivoRejeicao = motivo.trim();
  }

  /**
   * ★ Dia fora de 0–6 é ERRO, nunca descarte silencioso.
   *
   * `diasNormalizados` filtra o que não serve — o que é certo na LEITURA (dado
   * velho não pode quebrar a tela). Na ESCRITA, engolir um `7` transformaria um
   * erro de digitação do admin numa configuração diferente da que ele quis, e a
   * frase que o cliente lê sairia igualmente errada.
   *
   * Vazio/ausente continua sendo "todos os dias" — é o default de toda oferta
   * anterior a esta regra, e o que o formulário manda quando ninguém restringe
   * nada. O que NÃO existe é oferta com zero dias: seria um pacote impossível
   * de usar, à venda.
   */
  private static validarDias(dias: number[] | null | undefined): void {
    if (!dias) return;
    for (const dia of dias) {
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
        throw new InvarianteVioladaError(
          `Dia da semana inválido na oferta: ${dia} (esperado 0=domingo … 6=sábado)`,
        );
      }
    }
  }

  private static validar(
    nome: string,
    composicao: ItemComposicaoPacote[],
    preco: Dinheiro,
    contexto: ContextoValidacaoPacoteOferta,
  ): void {
    if (!nome.trim()) {
      throw new InvarianteVioladaError('Oferta de pacote exige nome');
    }
    if (composicao.length === 0) {
      throw new InvarianteVioladaError('Oferta de pacote exige ao menos um item na composição');
    }
    for (const item of composicao) {
      if (!Number.isInteger(item.quantidade) || item.quantidade <= 0) {
        throw new InvarianteVioladaError(`Quantidade inválida para o serviço ${item.servicoId} da composição`);
      }
    }
    if (!preco.ehPositivo()) {
      throw new InvarianteVioladaError('Preço do pacote deve ser maior que zero');
    }
    if (preco.centavos > contexto.somaAvulsos.centavos) {
      throw new InvarianteVioladaError(
        'Preço do pacote não pode ser maior que a soma dos avulsos (não é desconto negativo)',
      );
    }
  }

  desativar(): void {
    this.props.ativo = false;
  }

  reativar(): void {
    this.props.ativo = true;
  }

  /** Serviços repetidos por quantidade — para expandir na venda (rateio, §3.6). NÃO reescreve o rateio. */
  expandirServicoIds(): ServicoId[] {
    return this.props.composicao.flatMap((item) => Array<ServicoId>(item.quantidade).fill(item.servicoId));
  }

  get id() {
    return this.props.id;
  }
  get companyId() {
    return this.props.companyId;
  }
  get nome() {
    return this.props.nome;
  }
  get composicao(): ItemComposicaoPacote[] {
    return this.props.composicao.map((i) => ({ ...i }));
  }
  get preco() {
    return this.props.preco;
  }
  get ativo() {
    return this.props.ativo;
  }
  get diasPermitidos(): number[] {
    return [...this.props.diasPermitidos];
  }
  get statusAprovacao() {
    return this.props.statusAprovacao;
  }
  get motivoRejeicao() {
    return this.props.motivoRejeicao;
  }
}
