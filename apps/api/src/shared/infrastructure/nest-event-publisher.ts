import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from '../events/domain-event';
import { EventPublisher } from '../events/event-publisher';

@Injectable()
export class NestEventPublisher implements EventPublisher {
  constructor(private readonly emitter: EventEmitter2) {}

  async publicar(eventos: DomainEvent[]): Promise<void> {
    for (const evento of eventos) {
      await this.emitter.emitAsync(evento.nome, evento);
    }
  }
}
