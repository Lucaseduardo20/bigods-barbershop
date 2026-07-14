export interface DomainEvent {
  readonly nome: string;
  readonly ocorridoEm: Date;
}

export abstract class AggregateRoot {
  private eventos: DomainEvent[] = [];

  protected adicionarEvento(evento: DomainEvent): void {
    this.eventos.push(evento);
  }

  puxarEventos(): DomainEvent[] {
    const pendentes = this.eventos;
    this.eventos = [];
    return pendentes;
  }
}
