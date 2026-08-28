import { StatusSolicitacaoReembolso } from '@bigods/contracts';
import { AggregateRoot } from '../../../shared/events/domain-event';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { ClienteId, CompanyId, VendaDePacoteId } from '../../../shared/domain/ids';
import { InvarianteVioladaError, TransicaoDeEstadoInvalidaError } from '../../../shared/errors/domain-error';

export type SolicitacaoDeReembolsoId = string;

/**
 * Prazo fixo de negócio (§8.7), não parametrizável — ao contrário das janelas
 * de cancelamento/reagendamento (§8.6), o brief não pede ajuste pelo admin.
 * Centralizado aqui pra não duplicar o número em caso de uso e read model.
 */
export const PRAZO_REEMBOLSO_DIAS = 45;

/**
 * Quantas execuções falhas antes de desistir e ir para `FALHOU`.
 *
 * Não é "desistir do dinheiro": é parar de bater no gateway e **aparecer na tela
 * do admin**. O motivo mais provável de falha — saldo insuficiente na conta —
 * exige uma ação humana (deixar dinheiro lá), e retentar para sempre esconderia
 * exatamente isso atrás de um log que ninguém lê.
 *
 * Com o backoff de `proximaTentativaEm`, 8 tentativas cobrem mais de 24 horas.
 */
export const MAX_TENTATIVAS_DE_ESTORNO = 8;

/**
 * Quando retentar depois de uma falha: 30 min dobrando, com teto de 6 horas.
 *
 * Espaçamento crescente porque a causa provável (saldo) se resolve em horas, não
 * em minutos — retentar a cada 10 min só queimaria cota do gateway. Teto de 6h
 * porque acima disso as 8 tentativas passariam de dois dias, e dinheiro de cliente
 * parado tem custo de reputação.
 */
export function proximaTentativaEm(agora: Date, tentativas: number): Date {
  const minutos = Math.min(360, 30 * 2 ** Math.max(0, tentativas - 1));
  return new Date(agora.getTime() + minutos * 60_000);
}

export interface SolicitacaoDeReembolsoProps {
  id: SolicitacaoDeReembolsoId;
  companyId: CompanyId;
  vendaDePacoteId: VendaDePacoteId;
  clienteId: ClienteId;
  valor: Dinheiro;
  criadaEm: Date;
  prazoLimiteEm: Date;
  status: StatusSolicitacaoReembolso;
  reembolsadaEm: Date | null;

  // ── Estorno agendado (2026-08-27). Opcionais: aditivo, sem backfill. ────────
  /** Quando a execução pelo gateway deve acontecer. */
  agendadaPara?: Date | null;
  /** Quando o GATEWAY confirmou. Distinto de `reembolsadaEm` (ato do admin). */
  executadaEm?: Date | null;
  /** Id do estorno no gateway — a prova de que aconteceu. */
  gatewayRefundId?: string | null;
  tentativas?: number;
  /** Mensagem crua do gateway na última falha. Admin-only. */
  ultimoErro?: string | null;
}

/**
 * FASE 4b (sessão-E, §8.7): pedido de reembolso MANUAL do saldo residual de
 * um pacote — sem gateway, sem estorno automático. O dinheiro em si já foi
 * reservado no agregado `VendaDePacote` (`reservarSaldoParaReembolso`) no
 * exato instante em que esta solicitação é criada; este agregado só
 * rastreia o PEDIDO e seu estado (PENDENTE → REEMBOLSADO), auditável e
 * imutável quanto ao valor.
 */
export class SolicitacaoDeReembolso extends AggregateRoot {
  private constructor(private props: SolicitacaoDeReembolsoProps) {
    super();
  }

  static criar(params: {
    id: SolicitacaoDeReembolsoId;
    companyId: CompanyId;
    vendaDePacoteId: VendaDePacoteId;
    clienteId: ClienteId;
    valor: Dinheiro;
    prazoLimiteEm: Date;
    hoje: Date;
  }): SolicitacaoDeReembolso {
    if (!params.valor.ehPositivo()) {
      throw new InvarianteVioladaError('Valor da solicitação de reembolso deve ser maior que zero');
    }
    if (params.hoje.getTime() > params.prazoLimiteEm.getTime()) {
      throw new InvarianteVioladaError(
        'Prazo de 45 dias para pedir reembolso deste saldo já passou. Entre em contato pelo WhatsApp da barbearia.',
      );
    }
    return new SolicitacaoDeReembolso({
      id: params.id,
      companyId: params.companyId,
      vendaDePacoteId: params.vendaDePacoteId,
      clienteId: params.clienteId,
      valor: params.valor,
      criadaEm: params.hoje,
      prazoLimiteEm: params.prazoLimiteEm,
      status: StatusSolicitacaoReembolso.PENDENTE,
      reembolsadaEm: null,
    });
  }

  static reconstituir(props: SolicitacaoDeReembolsoProps): SolicitacaoDeReembolso {
    return new SolicitacaoDeReembolso(props);
  }

  /**
   * Admin confirma que devolveu o dinheiro por fora (PIX manual). Estado final.
   *
   * ## De onde se pode vir, e por quê
   *
   * **PENDENTE** — o caminho de sempre, e o único possível para pacote pago no
   * balcão (não há transação online para estornar).
   *
   * **FALHOU** — necessário, e seguro. Necessário porque uma devolução que
   * esgotou as tentativas com `PRAZO_VENCIDO` **nunca** vai passar pelo gateway:
   * sem esta saída ela ficaria presa para sempre, com o saldo do pacote eternamente
   * reservado. Seguro porque FALHOU significa que nenhum estorno aconteceu — a
   * chave de idempotência é estável, então um sucesso cuja resposta se perdeu teria
   * voltado como `jaExistia: true` na retentativa seguinte, virando REEMBOLSADO em
   * vez de FALHOU.
   *
   * ★ **AGENDADO não pode**, e é a trava: ali há execução a caminho, e marcar como
   * devolvida à mão faria o dinheiro sair **duas vezes** — uma pelo balcão, outra
   * pelo job. A saída de lá é `cancelarAgendamento`, explícita e registrada.
   */
  marcarReembolsada(agora: Date): void {
    const status = this.props.status;
    if (status !== StatusSolicitacaoReembolso.PENDENTE && status !== StatusSolicitacaoReembolso.FALHOU) {
      throw new TransicaoDeEstadoInvalidaError(
        `Solicitação em ${status} não pode ser marcada como reembolsada` +
          (status === StatusSolicitacaoReembolso.AGENDADO
            ? ' — há uma execução agendada pelo gateway. Cancele o agendamento primeiro,' +
              ' senão o dinheiro sairia duas vezes.'
            : ''),
      );
    }
    this.props.status = StatusSolicitacaoReembolso.REEMBOLSADO;
    this.props.reembolsadaEm = agora;
  }

  /**
   * Agenda (ou reagenda) a execução pelo gateway.
   *
   * Cobre TRÊS operações da tela do admin com uma transição, porque as três são
   * literalmente "definir quando executar":
   *
   *  - **agendar** — de PENDENTE, com o prazo padrão (31 dias);
   *  - **antecipar / executar agora** — de AGENDADO, com prazo 0;
   *  - **tentar de novo** — de FALHOU, o que também zera `tentativas`.
   *
   * Três casos de uso quase idênticos seriam três lugares para a mesma regra
   * divergir.
   *
   * ★ REEMBOLSADO não volta: é final, e o dinheiro já saiu. Reagendar dali seria
   * uma segunda devolução do mesmo valor.
   */
  agendar(agendadaPara: Date): void {
    const status = this.props.status;
    if (
      status !== StatusSolicitacaoReembolso.PENDENTE &&
      status !== StatusSolicitacaoReembolso.AGENDADO &&
      status !== StatusSolicitacaoReembolso.FALHOU
    ) {
      throw new TransicaoDeEstadoInvalidaError(
        `Solicitação em ${status} não pode ser agendada — o dinheiro já foi devolvido.`,
      );
    }
    // Sair de FALHOU zera o contador: é uma nova rodada de tentativas, decidida
    // por um humano que provavelmente resolveu a causa (deixou saldo na conta).
    // Mantê-lo faria a solicitação voltar a FALHOU na primeira falha.
    if (status === StatusSolicitacaoReembolso.FALHOU) {
      this.props.tentativas = 0;
      this.props.ultimoErro = null;
    }
    this.props.status = StatusSolicitacaoReembolso.AGENDADO;
    this.props.agendadaPara = agendadaPara;
  }

  /**
   * Desfaz o agendamento e volta a PENDENTE — a fila de decisão do admin.
   *
   * Existe porque `marcarReembolsada` recusa AGENDADO: sem esta saída, uma
   * solicitação agendada por engano ficaria presa até a execução acontecer.
   *
   * ★ Cancelar NÃO é "desistir de devolver". O saldo do pacote continua reservado
   * (`VendaDePacote.reservarSaldoParaReembolso`, feito na criação da solicitação);
   * o que se cancela é só o *quando* e o *como*.
   */
  cancelarAgendamento(): void {
    if (this.props.status !== StatusSolicitacaoReembolso.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Só uma solicitação AGENDADO tem agendamento a cancelar — esta está em ${this.props.status}`,
      );
    }
    this.props.status = StatusSolicitacaoReembolso.PENDENTE;
    this.props.agendadaPara = null;
  }

  /** A execução já pode acontecer? Usado pelo job para varrer o que venceu. */
  venceu(agora: Date): boolean {
    return (
      this.props.status === StatusSolicitacaoReembolso.AGENDADO &&
      this.props.agendadaPara !== null &&
      this.props.agendadaPara !== undefined &&
      this.props.agendadaPara.getTime() <= agora.getTime()
    );
  }

  /**
   * O gateway devolveu o dinheiro. Estado final.
   *
   * Idempotente para o MESMO id de estorno: o job pode retentar depois de uma
   * falha de rede em que o gateway na verdade completou, e o adapter traduz o 409
   * `idempotency_key_already_used` em sucesso. Reapontar para OUTRO id é recusado —
   * seria a prova de que houve uma segunda devolução, e mascarar isso apagaria o
   * único rastro dela.
   */
  registrarEstornoExecutado(gatewayRefundId: string, agora: Date): void {
    const atual = this.props.gatewayRefundId ?? null;
    if (atual !== null && atual !== gatewayRefundId) {
      throw new InvarianteVioladaError(
        `Solicitação ${this.props.id} já registrou o estorno ${atual} — não pode virar ` +
          `${gatewayRefundId}. Dois ids significam duas devoluções do mesmo valor.`,
      );
    }
    if (this.props.status === StatusSolicitacaoReembolso.REEMBOLSADO && atual === gatewayRefundId) {
      return; // no-op: mesma execução, registrada de novo
    }
    if (
      this.props.status !== StatusSolicitacaoReembolso.AGENDADO &&
      this.props.status !== StatusSolicitacaoReembolso.FALHOU
    ) {
      throw new TransicaoDeEstadoInvalidaError(
        `Solicitação em ${this.props.status} não pode registrar execução de estorno`,
      );
    }
    this.props.status = StatusSolicitacaoReembolso.REEMBOLSADO;
    this.props.gatewayRefundId = gatewayRefundId;
    this.props.executadaEm = agora;
    // `reembolsadaEm` também é preenchido: as duas telas (admin e conta do
    // cliente) já leem esse campo como "quando voltou", e deixá-lo nulo aqui faria
    // um estorno automático parecer não ter data. `executadaEm` é o campo
    // específico do gateway; este é o fato para quem lê.
    this.props.reembolsadaEm ??= agora;
  }

  /**
   * A execução falhou. Continua AGENDADO e retenta, até `MAX_TENTATIVAS_DE_ESTORNO`.
   *
   * Devolve `true` quando ainda vai retentar, `false` quando desistiu e foi para
   * FALHOU — quem chama usa isso para decidir o tom do log (aviso vs erro).
   *
   * ★ O erro cru é TRUNCADO: mensagens de gateway carregam payload inteiro em
   * alguns casos, e a coluna não é `text` infinito por acidente — é para o admin
   * ler, não para arquivar dump.
   */
  registrarFalhaNaExecucao(erro: string, agora: Date): boolean {
    if (this.props.status !== StatusSolicitacaoReembolso.AGENDADO) {
      throw new TransicaoDeEstadoInvalidaError(
        `Só uma solicitação AGENDADO pode falhar na execução — esta está em ${this.props.status}`,
      );
    }
    this.props.tentativas = (this.props.tentativas ?? 0) + 1;
    this.props.ultimoErro = erro.slice(0, 500);

    if (this.props.tentativas >= MAX_TENTATIVAS_DE_ESTORNO) {
      this.props.status = StatusSolicitacaoReembolso.FALHOU;
      // `agendadaPara` FICA preenchido de propósito: é o registro de quando a
      // última tentativa deveria ter acontecido. Zerá-lo perderia o histórico
      // justamente na solicitação que mais precisa ser investigada.
      return false;
    }
    this.props.agendadaPara = proximaTentativaEm(agora, this.props.tentativas);
    return true;
  }

  get agendadaPara(): Date | null { return this.props.agendadaPara ?? null; }
  get executadaEm(): Date | null { return this.props.executadaEm ?? null; }
  get gatewayRefundId(): string | null { return this.props.gatewayRefundId ?? null; }
  get tentativas(): number { return this.props.tentativas ?? 0; }
  get ultimoErro(): string | null { return this.props.ultimoErro ?? null; }

  get id() { return this.props.id; }
  get companyId() { return this.props.companyId; }
  get vendaDePacoteId() { return this.props.vendaDePacoteId; }
  get clienteId() { return this.props.clienteId; }
  get valor() { return this.props.valor; }
  get criadaEm() { return this.props.criadaEm; }
  get prazoLimiteEm() { return this.props.prazoLimiteEm; }
  get status() { return this.props.status; }
  get reembolsadaEm() { return this.props.reembolsadaEm; }
}
