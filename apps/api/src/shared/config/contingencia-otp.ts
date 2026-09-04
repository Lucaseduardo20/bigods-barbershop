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
 * - o passo do telefone ganha um ramo por SENHA (2026-09-04): telefone sem
 *   conta cria a própria senha ali; telefone com conta E senha entra com ela;
 *   telefone com conta SEM senha é mandado para a barbearia — e nunca pode
 *   criar senha no funil (ver abaixo);
 * - o restante das travas continua igual (cota de presenciais, janela de
 *   agendamento, conflito de horário, EXCLUDE).
 *
 * ## A senha não é prova de posse do telefone
 *
 * A senha criada no funil resolve ACESSO À CONTA, não identidade. Ninguém
 * confirmou que o número digitado é de quem digitou, então a criação NÃO emite
 * sessão e o agendamento continua nascendo pendente. Quem filtra agenda falsa
 * segue sendo a pessoa que aprova no painel.
 *
 * É por isso, também, que um telefone com conta e SEM senha nunca pode definir
 * uma no funil: aquela conta tem histórico, pacotes e créditos pagos, e sem OTP
 * não há como distinguir o dono de quem digitou o número primeiro. Esse caso é
 * destravado à mão, pelo admin, depois de confirmar a identidade por outros
 * meios (painel → Usuários → Clientes).
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
 * comportamento é a BORDA — e só ela. Hoje são três leitores, todos de
 * fronteira, nenhum no meio de uma regra:
 *
 * - `BookingPublicoController` — dispensa o código no agendamento avulso e
 *   marca o atendimento como pendente; responde `temSenha` em
 *   `/public/clientes/conhecido`, que é o que o funil usa para escolher o ramo;
 * - `ContaClienteController` — abre (e, com a flag desligada, FECHA com 404) a
 *   rota de criação de conta com senha;
 * - `EmpresaPublicaQueryService` — conta aos frontends que o desvio está
 *   ligado, para front e back nunca discordarem sobre isso.
 *
 * Nenhuma regra de domínio lê esta configuração.
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
