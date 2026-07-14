import { Atendimento } from './atendimento.aggregate';
import { AtendimentoId, BarbeiroId, ClienteId, CompanyId } from '../../../shared/domain/ids';

export interface AtendimentoRepository {
  porId(id: AtendimentoId): Promise<Atendimento | null>;
  agendadosDoBarbeiroNoPeriodo(
    barbeiroId: BarbeiroId,
    inicio: Date,
    fim: Date,
  ): Promise<Atendimento[]>;
  listarPorPeriodo(companyId: CompanyId, inicio: Date, fim: Date): Promise<Atendimento[]>;
  listarPorCliente(clienteId: ClienteId): Promise<Atendimento[]>;
  salvar(atendimento: Atendimento): Promise<void>;
}

export const ATENDIMENTO_REPOSITORY = Symbol('AtendimentoRepository');
