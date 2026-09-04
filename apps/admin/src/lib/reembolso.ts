import { MotivoDaFalhaDeEstorno, type SolicitacaoDeReembolsoDTO } from '@bigods/contracts';

/**
 * QUE AÇÕES A TELA DE REEMBOLSOS OFERECE, dado o estado da solicitação.
 *
 * ## Por que isto é uma função pura e não um punhado de `&&` no JSX
 *
 * A tabela tem três abas × dois tipos de pagamento × um caso de erro, e cada
 * combinação errada tem custo real: oferecer "agendar estorno" num pacote pago no
 * balcão leva o dono a um 400 depois de ele já ter decidido; esconder "já devolvi
 * por fora" de uma devolução com prazo vencido deixa a solicitação presa para
 * sempre. Espalhado no JSX, isso é invisível em revisão — aqui é uma tabela que se
 * lê e se testa.
 *
 * ★ Isto **não é** trava de segurança. Quem recusa de verdade é o backend: o
 * agregado rejeita `marcarReembolsada` em AGENDADO, e o caso de uso rejeita
 * agendar sem pagamento online. A tela apenas evita mostrar caminho que dá erro.
 */

export type AbaDeReembolso = 'PENDENTE' | 'AGENDADO' | 'FALHOU';

export interface AcoesDeReembolso {
  /** Agendar com o prazo padrão (31 dias). */
  agendar: boolean;
  /** Executar imediato (`prazoDias: 0`) — em AGENDADO isto é "antecipar", em FALHOU é "tentar de novo". */
  estornarAgora: boolean;
  cancelarAgendamento: boolean;
  /** "Já devolvi por fora" — fecha manualmente. */
  confirmarManual: boolean;
}

export function acoesDisponiveis(
  aba: AbaDeReembolso,
  s: Pick<SolicitacaoDeReembolsoDTO, 'estornoAutomatico'>,
): AcoesDeReembolso {
  if (aba === 'PENDENTE') {
    return {
      // Só com transação online por trás. Sem ela não há o que estornar, e o
      // backend recusa com 400.
      agendar: s.estornoAutomatico,
      estornarAgora: s.estornoAutomatico,
      cancelarAgendamento: false,
      // SEMPRE disponível: é o único caminho para pacote pago no balcão, e
      // continua legítimo para os demais (o dono pode preferir mandar um PIX).
      confirmarManual: true,
    };
  }

  if (aba === 'AGENDADO') {
    return {
      // Já está agendado — reagendar para o mesmo prazo não é uma ação.
      agendar: false,
      // "Antecipar".
      estornarAgora: true,
      cancelarAgendamento: true,
      // ★ NUNCA em AGENDADO. Há execução a caminho: marcar como devolvido à mão
      // faria o dinheiro sair duas vezes — uma pelo balcão, outra pelo job. O
      // agregado recusa, e a tela não deve nem sugerir. Para sair daqui,
      // `cancelarAgendamento` primeiro.
      confirmarManual: false,
    };
  }

  // FALHOU: as tentativas automáticas acabaram e nada foi devolvido.
  return {
    agendar: false,
    // "Tentar de novo" — reagenda para agora e zera o contador de tentativas.
    estornarAgora: true,
    cancelarAgendamento: false,
    // Indispensável em PRAZO_VENCIDO (retentar nunca vai funcionar) e legítimo
    // nos demais. Seguro porque FALHOU significa que nenhum estorno aconteceu: a
    // chave de idempotência é estável, então um sucesso com resposta perdida
    // teria voltado como `jaExistia` e virado REEMBOLSADO.
    confirmarManual: true,
  };
}

/**
 * A retentativa automática ainda tem chance de funcionar?
 *
 * Serve para a tela dar ênfase: com `PRAZO_VENCIDO`, "tentar de novo" só gera
 * outra falha e o caminho real é devolver por fora. Nos demais, insistir é a
 * primeira coisa a fazer.
 */
export function retentarFazSentido(motivo: MotivoDaFalhaDeEstorno): boolean {
  return motivo !== MotivoDaFalhaDeEstorno.PRAZO_VENCIDO;
}
