/**
 * Janela da reserva temporária de horário + intenção de pagamento online
 * (sessão de OTP+reserva — Problema 2: sem prazo curto, um PIX nunca pago
 * prenderia o horário indefinidamente). A MESMA janela alimenta, no mesmo
 * instante:
 * - `Atendimento.reservaOnlineExpiraEm` (avulso online);
 * - `IntencaoDePagamento.expiraEm` (avulso online e pacote — DECISAO_PENDENTE
 *   sobre a janela do pacote ter encolhido de 1h pra este valor, ver
 *   DECISOES_PENDENTES.md);
 * - `expiresIn` pedido de verdade à AbacatePay (nunca deixamos a AbacatePay
 *   aceitar um pagamento depois que já desistimos da reserva local — senão
 *   um PIX pago no minuto 15 confirmaria uma reserva que já expirou aos 10).
 *
 * Nomeada e centralizada (não espalhada como número mágico) pra poder ajustar
 * sem redeploy virar uma variável de ambiente no futuro, se a operação pedir.
 */
export const PRAZO_RESERVA_SEGUNDOS = 600; // 10 minutos
