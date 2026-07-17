import { OrigemDisponibilidade } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { IntervaloDeTempo } from '../../../shared/domain/intervalo-de-tempo';
import { BarbeiroId, DisponibilidadeId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export { OrigemDisponibilidade };

export interface DisponibilidadeProps {
  id: DisponibilidadeId;
  barbeiroId: BarbeiroId;
  /** Data no formato YYYY-MM-DD (dia local da barbearia). */
  data: string;
  janela: IntervaloDeTempo;
  origem: OrigemDisponibilidade;
}

export class DisponibilidadeBarbeiro extends AggregateRoot {
  private constructor(private props: DisponibilidadeProps) {
    super();
  }

  /**
   * `existentes`: janelas do mesmo barbeiro no mesmo dia — a invariante de
   * não-sobreposição atravessa instâncias, então a criação exige o conjunto atual.
   */
  static criar(
    props: Omit<DisponibilidadeProps, 'origem'> & { origem?: OrigemDisponibilidade },
    existentes: DisponibilidadeBarbeiro[],
  ): DisponibilidadeBarbeiro {
    const propsCompletas: DisponibilidadeProps = { ...props, origem: props.origem ?? OrigemDisponibilidade.MANUAL };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(props.data)) {
      throw new InvarianteVioladaError(`Data inválida (YYYY-MM-DD): ${props.data}`);
    }
    const conflito = existentes.find(
      (e) =>
        e.props.barbeiroId === props.barbeiroId &&
        e.props.data === props.data &&
        e.props.janela.sobrepoe(props.janela),
    );
    if (conflito) {
      throw new InvarianteVioladaError(
        `Janela sobrepõe disponibilidade existente do barbeiro no dia ${props.data}`,
      );
    }
    return new DisponibilidadeBarbeiro(propsCompletas);
  }

  static reconstituir(props: DisponibilidadeProps): DisponibilidadeBarbeiro {
    return new DisponibilidadeBarbeiro(props);
  }

  comporta(intervalo: IntervaloDeTempo): boolean {
    return this.props.janela.contem(intervalo);
  }

  get id() { return this.props.id; }
  get barbeiroId() { return this.props.barbeiroId; }
  get data() { return this.props.data; }
  get janela() { return this.props.janela; }
  get origem() { return this.props.origem; }
}
