import { AggregateRoot } from '../../../shared/events/domain-event';
import { BarbeiroId, CompanyId } from '../../../shared/domain/ids';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 0=domingo .. 6=sábado — mesma convenção de `Date.getUTCDay()` sobre a data civil. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Horário de parede LOCAL (fuso da empresa) — convertido na fronteira, como tudo mais. */
export interface JanelaExpediente {
  inicio: string; // "HH:mm"
  fim: string; // "HH:mm"
}

export interface ExpedienteSemanalProps {
  barbeiroId: BarbeiroId;
  companyId: CompanyId;
  /** Dia ausente do Map = sem expediente naquele dia (fechado). */
  dias: Map<DiaSemana, JanelaExpediente[]>;
}

/**
 * Expediente semanal recorrente de um barbeiro (item 1 da sessão): para cada
 * dia da semana, zero ou mais janelas de trabalho. É o GERADOR das
 * `DisponibilidadeBarbeiro` dos próximos dias (materialização, na aplicação) —
 * este agregado não cria disponibilidade nenhuma sozinho, só guarda a regra.
 */
export class ExpedienteSemanal extends AggregateRoot {
  private constructor(private props: ExpedienteSemanalProps) {
    super();
  }

  static criar(props: Omit<ExpedienteSemanalProps, 'dias'> & { dias?: Map<DiaSemana, JanelaExpediente[]> }): ExpedienteSemanal {
    const expediente = new ExpedienteSemanal({ ...props, dias: new Map() });
    for (const [dia, janelas] of props.dias ?? new Map()) {
      expediente.definirDia(dia, janelas);
    }
    return expediente;
  }

  static reconstituir(props: ExpedienteSemanalProps): ExpedienteSemanal {
    return new ExpedienteSemanal(props);
  }

  /** Substitui as janelas de um dia inteiro. Lista vazia = dia fechado. */
  definirDia(dia: DiaSemana, janelas: JanelaExpediente[]): void {
    validarJanelas(dia, janelas);
    if (janelas.length === 0) {
      this.props.dias.delete(dia);
    } else {
      // Ordenadas por início — facilita leitura e a checagem de sobreposição.
      this.props.dias.set(dia, [...janelas].sort((a, b) => a.inicio.localeCompare(b.inicio)));
    }
  }

  janelasDoDia(dia: DiaSemana): JanelaExpediente[] {
    return this.props.dias.get(dia) ?? [];
  }

  get barbeiroId() { return this.props.barbeiroId; }
  get companyId() { return this.props.companyId; }
  get dias(): ReadonlyMap<DiaSemana, JanelaExpediente[]> { return this.props.dias; }
}

function validarJanelas(dia: DiaSemana, janelas: JanelaExpediente[]): void {
  if (dia < 0 || dia > 6 || !Number.isInteger(dia)) {
    throw new InvarianteVioladaError(`Dia da semana inválido (0-6): ${dia}`);
  }
  for (const j of janelas) {
    if (!HORA_HHMM.test(j.inicio) || !HORA_HHMM.test(j.fim)) {
      throw new InvarianteVioladaError(`Horário inválido (HH:mm): ${j.inicio}-${j.fim}`);
    }
    if (j.inicio >= j.fim) {
      throw new InvarianteVioladaError(`Janela de expediente exige início antes do fim: ${j.inicio}-${j.fim}`);
    }
  }
  const ordenadas = [...janelas].sort((a, b) => a.inicio.localeCompare(b.inicio));
  for (let i = 1; i < ordenadas.length; i++) {
    if (ordenadas[i]!.inicio < ordenadas[i - 1]!.fim) {
      throw new InvarianteVioladaError(
        `Janelas do dia ${dia} não podem se sobrepor: ${ordenadas[i - 1]!.inicio}-${ordenadas[i - 1]!.fim} e ${ordenadas[i]!.inicio}-${ordenadas[i]!.fim}`,
      );
    }
  }
}
