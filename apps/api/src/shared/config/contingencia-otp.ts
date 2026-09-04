/**
 * CONTINGÊNCIA DE OTP (2026-09-04) — TEMPORÁRIA, por flag.
 *
 * ## O incidente
 *
 * O SMS de verificação parou de chegar de forma confiável. A causa é de
 * infraestrutura de entrega, não de código: a rota do provedor atual não é uma
 * rota A2P própria para OTP, e as mensagens somem no caminho sem erro nenhum do
 * nosso lado. O efeito é o pior possível — o cliente não consegue agendar nem
 * entrar na conta, e a barbearia perde horário marcado.
 *
 * ## O que esta flag faz
 *
 * `OTP_CONTINGENCIA=true` DESVIA do OTP; não o remove. Com ela ligada:
 *
 * - o funil aceita agendar sem verificar o telefone, e o agendamento nasce
 *   `AGUARDANDO_APROVACAO` em vez de firme — o filtro anti-poluição passa a ser
 *   uma pessoa aprovando no painel, no lugar do código;
 * - o restante das travas continua igual (cota de presenciais, janela de
 *   agendamento, conflito de horário, EXCLUDE).
 *
 * Com ela desligada — que é o default — o sistema volta 100% ao fluxo com OTP,
 * sem nenhuma pendência extra. Nada do código de OTP foi tocado.
 *
 * ## Por que um ponto de decisão só
 *
 * A tentação é espalhar `if (contingencia)` por controller, use case e tela. Aí
 * a volta ao normal vira uma caçada, e sempre sobra um `if` esquecido — que é
 * como uma contingência temporária vira permanente por acidente. Aqui a leitura
 * é uma função pura sobre o ambiente, injetada por símbolo, e quem decide
 * comportamento é a BORDA (o controller do funil), num lugar só.
 *
 * Ver DECISOES_PENDENTES: a causa raiz é contratar uma rota A2P própria para
 * OTP; quando ela existir, `OTP_CONTINGENCIA=false` (ou remover a variável)
 * devolve o fluxo normal sem outra sessão de trabalho.
 */

export interface ConfigContingenciaOtp {
  /** `true` só com a variável exatamente em `"true"` — nunca "quase ligado". */
  ativo: boolean;
}

export const CONFIG_CONTINGENCIA_OTP = Symbol('ConfigContingenciaOtp');

export function lerContingenciaOtp(
  env: NodeJS.ProcessEnv = process.env,
): ConfigContingenciaOtp {
  return { ativo: env.OTP_CONTINGENCIA === 'true' };
}
