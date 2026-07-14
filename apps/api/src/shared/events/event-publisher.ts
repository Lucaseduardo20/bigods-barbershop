import { DomainEvent } from './domain-event';

/** Porta de publicação de eventos — a infra pluga o EventEmitter do Nest. */
export interface EventPublisher {
  publicar(eventos: DomainEvent[]): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EventPublisher');
