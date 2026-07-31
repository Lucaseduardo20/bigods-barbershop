import { StatusAprovacaoPacoteOferta } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { BarbeiroId, CompanyId, PacoteOfertaId, ServicoId } from '../../../shared/domain/ids';
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
  /** Dono do pacote — cada barbeiro tem seu próprio catálogo de ofertas (Fase 2 do §8). */
  barbeiroId: BarbeiroId;
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
  ativo: boolean;
  /** Workflow de aprovação (Fase 3) — só APROVADO aparece no funil público. */
  statusAprovacao: StatusAprovacaoPacoteOferta;
  /** Preenchido só quando REJEITADO. */
  motivoRejeicao: string | null;
}

/**
 * Dados resolvidos pelo CALLER (use case) para validar a oferta — mantém o
 * domínio puro (sem acesso a repositório). `somaAvulsos` é a soma dos preços
 * de referência dos serviços da composição (a partir da Fase 2, é a soma dos
 * preços DO BARBEIRO dono, via `Barbeiro.precoPara`; a Fase 1 usa
 * `Servico.precoAvulso`, a única base que existe até então).
 */
export interface ContextoValidacaoPacoteOferta {
  somaAvulsos: Dinheiro;
  servicosAtendidosPeloBarbeiro: Set<ServicoId>;
}

export class PacoteOferta extends AggregateRoot {
  private constructor(private props: PacoteOfertaProps) {
    super();
  }

  /**
   * Barbeiro cria/edita → PENDENTE_APROVACAO por padrão (regra da Fase 3).
   * `RASCUNHO` existe como estado explícito da máquina, mas nada nesta sessão
   * dispara sua criação automaticamente — só é alcançável passando
   * `statusAprovacao: RASCUNHO` explicitamente.
   * DECISAO_PENDENTE: se deveria existir um fluxo de UI "salvar rascunho"
   * separado de "enviar pra aprovação" — não estava especificado.
   */
  static criar(
    props: Omit<PacoteOfertaProps, 'ativo' | 'statusAprovacao' | 'motivoRejeicao'> & {
      ativo?: boolean;
      statusAprovacao?: StatusAprovacaoPacoteOferta;
    },
    contexto: ContextoValidacaoPacoteOferta,
  ): PacoteOferta {
    PacoteOferta.validar(props.nome, props.composicao, props.preco, contexto);
    return new PacoteOferta({
      ...props,
      nome: props.nome.trim(),
      composicao: props.composicao.map((i) => ({ ...i })),
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
    dados: { nome: string; composicao: ItemComposicaoPacote[]; preco: Dinheiro },
    contexto: ContextoValidacaoPacoteOferta,
  ): void {
    PacoteOferta.validar(dados.nome, dados.composicao, dados.preco, contexto);
    this.props.nome = dados.nome.trim();
    this.props.composicao = dados.composicao.map((i) => ({ ...i }));
    this.props.preco = dados.preco;
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
   * Aprova — quem chama (admin) já foi autorizado na borda; um admin que
   * TAMBÉM é o barbeiro dono do pacote PODE aprovar o próprio (decisão
   * consciente — senão o fluxo trava com um único admin/barbeiro real).
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
      if (!contexto.servicosAtendidosPeloBarbeiro.has(item.servicoId)) {
        throw new InvarianteVioladaError(`Barbeiro dono não atende o serviço ${item.servicoId} da composição`);
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
  get barbeiroId() {
    return this.props.barbeiroId;
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
  get statusAprovacao() {
    return this.props.statusAprovacao;
  }
  get motivoRejeicao() {
    return this.props.motivoRejeicao;
  }
}
