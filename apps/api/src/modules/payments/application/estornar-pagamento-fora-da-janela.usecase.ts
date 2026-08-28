import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { PAYMENT_GATEWAY, PaymentGateway } from '../domain/payment-gateway';

export interface ResultadoDoEstorno {
  /** true quando o gateway confirmou (ou confirmou que já havia confirmado). */
  estornado: boolean;
  motivo?: string;
}

/**
 * Devolve o dinheiro de uma cobrança que foi paga DEPOIS da janela expirar.
 *
 * ## O cenário, e por que ele é automático
 *
 * Decisão do dono: o cliente que paga fora dos 30 minutos perdeu o horário, então
 * o dinheiro volta sozinho e ele é avisado para reagendar. Não fazer isso
 * automaticamente significaria ficar com dinheiro sem contrapartida até alguém
 * notar — e quem notaria primeiro é o cliente.
 *
 * ## O protocolo de três tempos, e por que ele não é opcional
 *
 * A chamada ao gateway acontece FORA de transação (o `$transaction` do Prisma tem
 * timeout de 5s; latência de rede lá dentro vira rollback silencioso). Isso cria
 * uma janela entre "decidi estornar" e "sei se estornou". Então:
 *
 *   T1 (transação) marca `estornoSolicitadoEm`. Se já estava marcado, segue —
 *      é retentativa, não pedido novo.
 *   T2 (fora)      chama o gateway com chave de idempotência ESTÁVEL.
 *   T3 (transação) grava o id do estorno, ou o erro.
 *
 * Morte entre T1 e T2 deixa a linha em `estornoSolicitadoEm != null &&
 * estornoGatewayId == null` — exatamente o que `ReconciliarPagamentosJob` varre.
 *
 * ## Por que a chave de idempotência é estável AQUI, e nova na criação
 *
 * Criar cobrança: chave nova a cada chamada, porque cada tentativa É uma cobrança
 * nova (cartão recusado, cliente tenta outro).
 *
 * Estornar: chave ESTÁVEL derivada da intenção. Sem isso, a retentativa do job
 * criaria uma SEGUNDA devolução — a Orders API trata chave nova como pedido novo.
 * Com a chave estável, o gateway responde 409 e o adapter traduz em
 * `jaExistia: true`, que é sucesso.
 */
@Injectable()
export class EstornarPagamentoForaDaJanelaUseCase {
  private readonly logger = new Logger(EstornarPagamentoForaDaJanelaUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async executar(input: { intencaoId: string; agora?: Date }): Promise<ResultadoDoEstorno> {
    const agora = input.agora ?? new Date();

    // ── T1: marcar a intenção, em transação ──────────────────────────────────
    const preparo = await this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porId(input.intencaoId);
      if (!intencao) return { seguir: false as const, motivo: 'intenção não encontrada' };

      if (intencao.estornoGatewayId != null) {
        // Já concluído. Nada a fazer, e nada de chamar o gateway de novo.
        return { seguir: false as const, motivo: 'estorno já concluído' };
      }
      if (intencao.gatewayId == null) {
        // Sem id da cobrança no gateway não há o que estornar lá. Acontece com
        // linha antiga ou cobrança criada no modo manual por WhatsApp.
        return { seguir: false as const, motivo: 'intenção sem gatewayId — nada a estornar' };
      }

      // Devolve false quando já estava marcado: é retentativa, e a gente segue.
      const primeiraVez = intencao.solicitarEstornoAutomatico(agora);
      await repos.intencoesDePagamento.salvar(intencao);
      return {
        seguir: true as const,
        gatewayId: intencao.gatewayId,
        primeiraVez,
        // Estável e derivada da intenção: `estorno-<uuid>` tem 44 caracteres,
        // dentro dos dois limites que a doc do Mercado Pago se contradiz em dizer.
        chave: `estorno-${intencao.id}`,
      };
    });

    if (!preparo.seguir) {
      return { estornado: false, motivo: preparo.motivo };
    }
    if (!preparo.primeiraVez) {
      this.logger.log(
        `Retentando estorno da intenção ${input.intencaoId} (já estava solicitado) — ` +
          'a chave de idempotência estável impede uma segunda devolução.',
      );
    }

    // ── T2: chamar o gateway, FORA de transação ──────────────────────────────
    let estornoId: string;
    let jaExistia = false;
    try {
      const r = await this.gateway.estornar({
        gatewayId: preparo.gatewayId,
        idempotencyKey: preparo.chave,
      });
      estornoId = r.estornoId;
      jaExistia = r.jaExistia === true;
    } catch (erro) {
      const mensagem = (erro as Error).message;
      // ── T3 (falha) ─────────────────────────────────────────────────────────
      // Grava o motivo e MANTÉM em voo: o job repesca. O caso mais provável é
      // saldo insuficiente na conta do gateway — a doc é explícita que o estorno
      // exige saldo disponível, e a operação saca o saldo para pagar barbeiro.
      await this.uow.transacao(async (repos) => {
        const intencao = await repos.intencoesDePagamento.porId(input.intencaoId);
        if (!intencao) return;
        intencao.registrarFalhaNoEstorno(mensagem);
        await repos.intencoesDePagamento.salvar(intencao);
      });
      this.logger.error(
        `Estorno da intenção ${input.intencaoId} falhou: ${mensagem}. Continua em voo; o job retentará.`,
      );
      return { estornado: false, motivo: mensagem };
    }

    // ── T3 (sucesso) ─────────────────────────────────────────────────────────
    await this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porId(input.intencaoId);
      if (!intencao) return;
      intencao.registrarEstornoExecutado(estornoId);
      await repos.intencoesDePagamento.salvar(intencao);
    });

    this.logger.warn(
      `Pagamento fora da janela DEVOLVIDO — intenção ${input.intencaoId}, estorno ${estornoId}` +
        `${jaExistia ? ' (o gateway indicou que já havia sido aceito)' : ''}. ` +
        'O cliente precisa reagendar.',
    );
    return { estornado: true };
  }
}
