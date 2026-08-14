import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * Problema 3 (sessão de OTP+reserva): OTP prova que o telefone é real, mas
 * não impede que o MESMO cliente, já verificado, marque dezenas de
 * presenciais e entupa a agenda — a trava certa aqui é limite de
 * agendamentos, não mais autenticação. Vale só pra PRESENCIAL: online já tem
 * o pagamento como trava natural contra abuso (§ regra de reserva).
 *
 * Parametrizável (não número mágico) pra ajustar conforme a operação real
 * mostrar o que é normal.
 */
export const LIMITE_PRESENCIAIS_FUTUROS_ATIVOS = 3;

/**
 * `presenciaisFuturosAtivos` é a contagem ANTES de somar o novo agendamento
 * que está prestes a ser criado — chamar antes de persistir.
 */
export function assertNaoExcedeCotaPresencial(presenciaisFuturosAtivos: number): void {
  if (presenciaisFuturosAtivos >= LIMITE_PRESENCIAIS_FUTUROS_ATIVOS) {
    throw new InvarianteVioladaError(
      `Você já tem ${LIMITE_PRESENCIAIS_FUTUROS_ATIVOS} horários marcados; conclua ou cancele um para marcar outro.`,
    );
  }
}
