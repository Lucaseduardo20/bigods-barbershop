import { AggregateRoot } from '../../../shared/events/domain-event';
import { Telefone } from '../../../shared/domain/telefone';
import { ClienteId, CompanyId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export interface ClienteProps {
  id: ClienteId;
  companyId: CompanyId;
  nome: string;
  telefone: Telefone;
  /** null enquanto não promovido a usuário autenticável (compra de pacote promove). */
  cognitoSub: string | null;
}

export class Cliente extends AggregateRoot {
  private constructor(private props: ClienteProps) {
    super();
  }

  static criar(props: Omit<ClienteProps, 'cognitoSub'>): Cliente {
    if (!props.nome.trim()) {
      throw new InvarianteVioladaError('Cliente exige nome');
    }
    return new Cliente({ ...props, nome: props.nome.trim(), cognitoSub: null });
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
}
