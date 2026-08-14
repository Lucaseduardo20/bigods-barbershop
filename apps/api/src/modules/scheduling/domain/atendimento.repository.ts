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
  /**
   * Cota de presenciais futuros ativos (Problema 3, sessão de OTP+reserva):
   * conta AGENDADO com início no futuro e `reservaOnlineExpiraEm` null (nunca
   * passou pelo canal online) — RESERVADO/RESERVA_EXPIRADA/CANCELADO/
   * CONCLUIDO/NAO_COMPARECEU nunca contam.
   */
  contarPresenciaisFuturosAtivosDoCliente(clienteId: ClienteId, agora: Date): Promise<number>;
  salvar(atendimento: Atendimento): Promise<void>;
}

export const ATENDIMENTO_REPOSITORY = Symbol('AtendimentoRepository');
