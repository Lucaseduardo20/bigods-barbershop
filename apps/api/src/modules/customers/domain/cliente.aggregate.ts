import { AggregateRoot } from '../../../shared/events/domain-event';
import { Telefone } from '../../../shared/domain/telefone';
import { ClienteId, CompanyId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export interface ClienteProps {
  id: ClienteId;
  companyId: CompanyId;
  nome: string;
  telefone: Telefone;
  /** null enquanto não promovido a usuário autenticável (confirmação do OTP promove). */
  cognitoSub: string | null;
  /** Opcional — o funil coleta se o cliente quiser. */
  email: string | null;
  /** "Fale sobre você": preferências que o BARBEIRO usa no atendimento. Opcional. */
  sobreVoce: string | null;
  /**
   * Senha do cliente (2026-08-28) — já HASHEADA. `null` = ainda não definiu.
   *
   * O domínio guarda o hash e nunca a senha: o formato é decisão de
   * armazenamento (`infrastructure/senha.ts`, o mesmo motor scrypt do login de
   * staff), e o agregado só sabe que existe ou não existe uma credencial.
   */
  senhaHash: string | null;
}

/**
 * Nome provisório de um `Cliente` criado por login OTP sem cadastro prévio
 * (§8.9). Fica aqui, no domínio, porque duas coisas dependem de reconhecê-lo:
 * quem o cria e quem decide se pode substituí-lo.
 */
export const NOME_PLACEHOLDER = 'Cliente';

export class Cliente extends AggregateRoot {
  private constructor(private props: ClienteProps) {
    super();
  }

  static criar(
    props: Omit<ClienteProps, 'cognitoSub' | 'email' | 'sobreVoce' | 'senhaHash'>,
  ): Cliente {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Cliente exige nome');
    }
    return new Cliente({
      ...props,
      nome: props.nome.trim(),
      cognitoSub: null,
      email: null,
      sobreVoce: null,
      // Nasce SEM senha: o cliente que acabou de agendar ainda não escolheu
      // uma, e todo cliente que já existia também está assim. Quem não tem
      // senha entra pelo primeiro acesso, com o telefone verificado.
      senhaHash: null,
    });
  }

  /**
   * Dados opcionais do funil. Só sobrescreve o que veio PREENCHIDO: um
   * agendamento posterior em que o cliente deixou o campo em branco não pode
   * apagar o que ele já tinha informado antes.
   */
  atualizarDadosOpcionais(dados: { email?: string | null; sobreVoce?: string | null }): void {
    const email = dados.email?.trim();
    if (email) this.props.email = email;
    const sobreVoce = dados.sobreVoce?.trim();
    if (sobreVoce) this.props.sobreVoce = sobreVoce;
  }

  /**
   * Renomeia de forma incondicional. Use com cuidado: hoje só o próprio
   * cadastro (quando existir edição de perfil) deveria chamar isto.
   */
  renomear(nome: string): void {
    const limpo = nome.trim();
    if (limpo && limpo !== this.props.nome) this.props.nome = limpo;
  }

  /**
   * Nome ainda não informado de verdade — só o placeholder que o login por OTP
   * deixa quando o `Cliente` nasce sem cadastro prévio (§8.9,
   * `ConfirmarLoginClienteUseCase`).
   */
  get nomeEhPlaceholder(): boolean {
    return this.props.nome.trim() === NOME_PLACEHOLDER;
  }

  /**
   * O que o FUNIL pode fazer com o nome (2026-08-21): completar o cadastro de
   * quem ainda não tem nome, nunca sobrescrever o de quem já tem.
   *
   * Antes o funil sempre vencia, com o argumento de que era "a única fonte da
   * verdade sobre o nome". Na prática isso deixava o cadastro à mercê de
   * qualquer agendamento: bastava alguém digitar outra coisa — um apelido, um
   * erro de digitação, o nome de quem estava marcando pra outra pessoa — e o
   * cadastro do cliente era reescrito. Foi reportado como problema real.
   *
   * Devolve `true` quando adotou o nome, para quem chama saber se mudou algo.
   */
  adotarNomeSeAusente(nome: string): boolean {
    if (!this.nomeEhPlaceholder) return false;
    const limpo = nome.trim();
    if (!limpo || limpo === this.props.nome) return false;
    this.props.nome = limpo;
    return true;
  }

  static reconstituir(props: ClienteProps): Cliente {
    return new Cliente(props);
  }

  /** Promoção a usuário autenticável — acontece na compra do primeiro pacote. */
  promoverParaUsuario(cognitoSub: string): void {
    if (!cognitoSub.trim()) {
      throw new InvarianteVioladaError('cognitoSub não pode ser vazio na promoção');
    }
    if (this.props.cognitoSub !== null && this.props.cognitoSub !== cognitoSub) {
      throw new InvarianteVioladaError('Cliente já promovido com outro cognitoSub');
    }
    this.props.cognitoSub = cognitoSub;
  }

  /**
   * Define (ou redefine) a senha. Recebe o hash PRONTO — quem calcula é a
   * infraestrutura, com o mesmo motor do login de staff.
   *
   * Serve aos dois caminhos: primeiro acesso e "esqueci a senha". São telas
   * diferentes e regras de AUTORIZAÇÃO diferentes (quem pode chegar aqui é
   * decidido na aplicação), mas o efeito sobre o cliente é o mesmo — e um
   * segundo método faria a mesma coisa com outro nome.
   */
  definirSenha(hash: string): void {
    if (!hash.trim()) {
      throw new InvarianteVioladaError('Senha do cliente exige hash');
    }
    this.props.senhaHash = hash;
  }

  /** Já escolheu uma senha? É o que separa o primeiro acesso do login normal. */
  get temSenha(): boolean {
    return this.props.senhaHash !== null;
  }

  get ehUsuario(): boolean {
    return this.props.cognitoSub !== null;
  }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get nome() { return this.props.nome; }
  get telefone() { return this.props.telefone; }
  get cognitoSub() { return this.props.cognitoSub; }
  get email() { return this.props.email; }
  get sobreVoce() { return this.props.sobreVoce; }
  get senhaHash() { return this.props.senhaHash; }
}
