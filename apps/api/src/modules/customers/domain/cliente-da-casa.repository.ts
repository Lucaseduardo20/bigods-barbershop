import { BarbeiroId, ClienteId } from '../../../shared/domain/ids';

/**
 * "Cliente da casa": relação BARBEIRO ↔ CLIENTE, não um atributo do cliente.
 *
 * O mesmo cliente é da casa do Gabriel e pode não ser do Lucas — é uma relação
 * de confiança pessoal, e por isso vale só na agenda de quem marcou. Modelar
 * como flag no `Cliente` teria feito a marca de um barbeiro valer para todos.
 *
 * Sem status e sem soft-delete (CLAUDE.md): ou a linha existe (é da casa) ou
 * não existe. Marcar duas vezes é idempotente.
 */
export interface ClienteDaCasaRepository {
  ehDaCasa(barbeiroId: BarbeiroId, clienteId: ClienteId): Promise<boolean>;
  marcar(barbeiroId: BarbeiroId, clienteId: ClienteId): Promise<void>;
  desmarcar(barbeiroId: BarbeiroId, clienteId: ClienteId): Promise<void>;
  /** Clientes da casa DE UM barbeiro. */
  clientesDoBarbeiro(barbeiroId: BarbeiroId): Promise<ClienteId[]>;
  /** De quais barbeiros este cliente é "da casa" — visão do admin. */
  barbeirosDoCliente(clienteId: ClienteId): Promise<BarbeiroId[]>;
}

export const CLIENTE_DA_CASA_REPOSITORY = Symbol('ClienteDaCasaRepository');
