/**
 * Janela da reserva TEMPORÁRIA de horário do AVULSO ONLINE (sessão de
 * OTP+reserva — Problema 2: sem prazo curto, um PIX nunca pago prenderia o
 * horário indefinidamente). Alimenta, no MESMO instante:
 * - `Atendimento.reservaOnlineExpiraEm`;
 * - `IntencaoDePagamento.expiraEm` (só quando a referência é um ATENDIMENTO);
 * - `expiresIn` pedido de verdade à AbacatePay (nunca deixamos a AbacatePay
 *   aceitar um pagamento depois que já desistimos da reserva local — senão
 *   um PIX pago no minuto 15 confirmaria uma reserva que já expirou aos 10).
 *
 * ⚠️ NÃO use esta constante pro prazo de pagamento do PACOTE — `VendaDePacote`
 * não reserva horário nenhum (não é agenda), então o motivo de ser CURTO
 * (proteger um slot preso) não existe pra ele. Pacote usa
 * `gateway.expiraEmSegundos` (1h, configurável via `ABACATEPAY_EXPIRA_SEGUNDOS`)
 * — ver `vender-pacote.usecase.ts`. Os dois foram unificados por engano numa
 * sessão anterior (DECISOES_PENDENTES.md #28, resolvida) — não os unifique de
 * novo: são conceitos diferentes (reserva de slot vs. prazo de pagamento) que
 * coincidentemente podiam ter o mesmo valor, não uma regra que os liga.
 *
 * Nomeada e centralizada (não espalhada como número mágico) pra poder ajustar
 * sem redeploy virar uma variável de ambiente no futuro, se a operação pedir.
 */
export const PRAZO_RESERVA_SEGUNDOS = 600; // 10 minutos — SÓ avulso online
