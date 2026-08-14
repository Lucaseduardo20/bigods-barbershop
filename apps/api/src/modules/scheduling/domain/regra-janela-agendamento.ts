import { LIMITE_DIAS_AGENDAMENTO } from '@bigods/contracts';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

export { LIMITE_DIAS_AGENDAMENTO };

/**
 * Janela máxima de agendamento: o cliente marca no máximo até hoje +
 * `LIMITE_DIAS_AGENDAMENTO` dias. Sem isso a agenda vira promessa de longo
 * prazo que a barbearia não tem como honrar — preço muda, barbeiro sai,
 * expediente muda, e o horário já estava "vendido".
 *
 * A constante vive em `@bigods/contracts` porque o funil precisa da MESMA
 * janela para nem oferecer as datas fora dela (feedback imediato); aqui é onde
 * ela é imposta de verdade.
 *
 * Comparação em DIA CIVIL LOCAL, nunca em milissegundos: "hoje + 30" é um dia
 * do calendário do fuso da empresa. Fazer `inicio - agora <= 30*24h` erraria na
 * virada de horário de verão e trataria "amanhã às 08h" de forma diferente de
 * "amanhã às 20h".
 *
 * Vale só para o auto-atendimento (funil público + cockpit). O admin agenda
 * por julgamento próprio — mesmo critério da cota de presenciais.
 */
export function assertDentroDaJanelaDeAgendamento(params: {
  /** Dia civil local do agendamento pretendido (YYYY-MM-DD). */
  diaDoAgendamento: string;
  /** Dia civil local de hoje (YYYY-MM-DD), no fuso da empresa. */
  hoje: string;
}): void {
  const limite = somarDias(params.hoje, LIMITE_DIAS_AGENDAMENTO);
  // Comparação lexicográfica funciona e é exata para YYYY-MM-DD.
  if (params.diaDoAgendamento > limite) {
    throw new InvarianteVioladaError(
      `Agendamentos são liberados com até ${LIMITE_DIAS_AGENDAMENTO} dias de antecedência.`,
    );
  }
}

/**
 * Aritmética de calendário em UTC sobre um dia civil já resolvido — datas
 * civis são agnósticas de fuso depois que "hoje" foi fixado no fuso certo, e
 * fazer as contas em UTC evita drift de horário de verão.
 */
export function somarDias(diaISO: string, dias: number): string {
  const [ano, mes, dia] = diaISO.split('-').map(Number);
  return new Date(Date.UTC(ano!, mes! - 1, dia! + dias)).toISOString().slice(0, 10);
}
