import { Papel } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Percentual } from '../../../shared/domain/percentual';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { BarbeiroId, CompanyId, ServicoId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/** Legível, sem acento/espaço — vai numa URL pública (§4b). */
const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface BarbeiroProps {
  id: BarbeiroId;
  companyId: CompanyId;
  nome: string;
  /**
   * Link pessoal de marketing (sessão-B, Fase 4b) — "/?barbeiro={slug}" em vez
   * de UUID. Único por empresa; unicidade é responsabilidade do CALLER (é
   * preciso consultar outros barbeiros — dado de repositório, fora do domínio
   * puro), o agregado só valida o FORMATO.
   */
  slug: string;
  papeis: Set<Papel>;
  comissaoPadrao: Percentual;
  excecoesComissao: Map<ServicoId, Percentual>;
  servicosAtendidos: Set<ServicoId>;
  /**
   * Percentual ÚNICO de comissão sobre produto, para TODOS os produtos —
   * sem matriz por produto (decisão consciente: a matriz por serviço existe
   * por margens de mão de obra distintas; produto é revenda). Default 0%.
   */
  comissaoProdutos: Percentual;
  /**
   * Override de preço por serviço (sessão-B, Fase 2) — MESMO padrão de
   * `excecoesComissao`. Ausência = usa `Servico.precoAvulso` (referência da
   * casa); ver `precoPara` no módulo `precificacao-pacote.ts` (o domínio do
   * Barbeiro não conhece Servico, só guarda o override).
   */
  precosServicos: Map<ServicoId, Dinheiro>;
  /**
   * Foto de perfil (2026-08-19, resolve DECISOES_PENDENTES #4) — URL pública
   * no bucket de uploads, ou `null`. O domínio guarda a URL e não sabe de S3:
   * quem sobe/apaga o byte é a camada de armazenamento, e a regra daqui é só
   * uma — trocar a foto devolve a anterior pra quem souber apagá-la.
   */
  fotoUrl: string | null;
  ativo: boolean;
}

export class Barbeiro extends AggregateRoot {
  private constructor(private props: BarbeiroProps) {
    super();
  }

  static criar(props: Omit<BarbeiroProps, 'ativo' | 'excecoesComissao' | 'servicosAtendidos' | 'comissaoProdutos' | 'precosServicos' | 'fotoUrl'> & {
    ativo?: boolean;
    excecoesComissao?: Map<ServicoId, Percentual>;
    servicosAtendidos?: Set<ServicoId>;
    comissaoProdutos?: Percentual;
    precosServicos?: Map<ServicoId, Dinheiro>;
    fotoUrl?: string | null;
  }): Barbeiro {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Barbeiro exige nome');
    }
    if (props.papeis.size === 0) {
      throw new InvarianteVioladaError('Barbeiro exige ao menos um papel');
    }
    Barbeiro.validarSlug(props.slug);
    return new Barbeiro({
      ...props,
      nome: props.nome.trim(),
      excecoesComissao: props.excecoesComissao ?? new Map(),
      servicosAtendidos: props.servicosAtendidos ?? new Set(),
      comissaoProdutos: props.comissaoProdutos ?? Percentual.dePontosBase(0),
      precosServicos: props.precosServicos ?? new Map(),
      fotoUrl: props.fotoUrl ?? null,
      ativo: props.ativo ?? true,
    });
  }

  static reconstituir(props: BarbeiroProps): Barbeiro {
    return new Barbeiro(props);
  }

  /** Formato do slug — unicidade é responsabilidade do caller (§ BarbeiroProps.slug). */
  private static validarSlug(slug: string): void {
    if (!SLUG_VALIDO.test(slug)) {
      throw new InvarianteVioladaError(
        `Slug inválido: "${slug}" (use só letras minúsculas, números e hífen, sem começar/terminar com hífen)`,
      );
    }
  }

  /** Admin pode editar o slug (§4b) — unicidade checada pelo caller antes de chamar. */
  atualizarSlug(slug: string): void {
    Barbeiro.validarSlug(slug);
    this.props.slug = slug;
  }

  renomear(nome: string): void {
    if (!nome.trim()) {
      throw new InvarianteVioladaError('Barbeiro exige nome');
    }
    this.props.nome = nome.trim();
  }

  /** Papéis são um conjunto, nunca vazio — a trava do último admin ativo (regra
   * cross-agregado) é responsabilidade do caller, ver `regra-admin-minimo.ts`. */
  atualizarPapeis(papeis: Set<Papel>): void {
    if (papeis.size === 0) {
      throw new InvarianteVioladaError('Barbeiro exige ao menos um papel');
    }
    this.props.papeis = new Set(papeis);
  }

  /** Soft-disable (nunca deletar — histórico de comissão/atendimento fica intacto). */
  desativar(): void {
    this.props.ativo = false;
  }

  ativar(): void {
    this.props.ativo = true;
  }

  /** Matriz de comissão: exceção por serviço, senão o padrão. */
  percentualPara(servicoId: ServicoId): Percentual {
    return this.props.excecoesComissao.get(servicoId) ?? this.props.comissaoPadrao;
  }

  definirExcecaoComissao(servicoId: ServicoId, percentual: Percentual): void {
    this.props.excecoesComissao.set(servicoId, percentual);
  }

  definirComissaoProdutos(percentual: Percentual): void {
    this.props.comissaoProdutos = percentual;
  }

  removerExcecaoComissao(servicoId: ServicoId): void {
    this.props.excecoesComissao.delete(servicoId);
  }

  /** Override de preço deste barbeiro para um serviço, se houver — sem fallback (ver `precoPara`). */
  overridePrecoPara(servicoId: ServicoId): Dinheiro | null {
    return this.props.precosServicos.get(servicoId) ?? null;
  }

  definirPrecoServico(servicoId: ServicoId, preco: Dinheiro): void {
    if (!preco.ehPositivo()) {
      throw new InvarianteVioladaError('Preço do serviço para o barbeiro deve ser maior que zero');
    }
    this.props.precosServicos.set(servicoId, preco);
  }

  removerPrecoServico(servicoId: ServicoId): void {
    this.props.precosServicos.delete(servicoId);
  }

  atende(servicoId: ServicoId): boolean {
    return this.props.servicosAtendidos.has(servicoId);
  }

  habilitarServico(servicoId: ServicoId): void {
    this.props.servicosAtendidos.add(servicoId);
  }

  desabilitarServico(servicoId: ServicoId): void {
    this.props.servicosAtendidos.delete(servicoId);
  }

  temPapel(papel: Papel): boolean {
    return this.props.papeis.has(papel);
  }

  /**
   * Troca a foto e DEVOLVE a URL da anterior, para o chamador apagá-la do
   * bucket. Devolver em vez de apagar aqui é de propósito: o domínio não faz
   * I/O. Se ninguém aproveitar o retorno, sobra um objeto órfão — por isso o
   * caso de uso é curto e óbvio.
   */
  definirFoto(url: string): string | null {
    if (!url.trim()) {
      throw new InvarianteVioladaError('Foto exige URL');
    }
    const anterior = this.props.fotoUrl;
    this.props.fotoUrl = url.trim();
    return anterior;
  }

  /** Remove a foto e devolve a que saiu (mesma razão de `definirFoto`). */
  removerFoto(): string | null {
    const anterior = this.props.fotoUrl;
    this.props.fotoUrl = null;
    return anterior;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get nome() { return this.props.nome; }
  get slug() { return this.props.slug; }
  get papeis() { return new Set(this.props.papeis); }
  get comissaoPadrao() { return this.props.comissaoPadrao; }
  get comissaoProdutos() { return this.props.comissaoProdutos; }
  get excecoesComissao() { return new Map(this.props.excecoesComissao); }
  get precosServicos() { return new Map(this.props.precosServicos); }
  get servicosAtendidos() { return new Set(this.props.servicosAtendidos); }
  get fotoUrl() { return this.props.fotoUrl; }
  get ativo() { return this.props.ativo; }
}
