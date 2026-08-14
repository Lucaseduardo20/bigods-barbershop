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
}

export class Cliente extends AggregateRoot {
  private constructor(private props: ClienteProps) {
    super();
  }

  static criar(props: Omit<ClienteProps, 'cognitoSub' | 'email' | 'sobreVoce'>): Cliente {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Cliente exige nome');
    }
    return new Cliente({
      ...props,
      nome: props.nome.trim(),
      cognitoSub: null,
      email: null,
      sobreVoce: null,
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
}
