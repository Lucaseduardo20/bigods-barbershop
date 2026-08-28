import { Inject, Injectable, Logger } from '@nestjs/common';
import { StatusPagamento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { PAYMENT_GATEWAY, PaymentGateway } from '../../payments/domain/payment-gateway';

export interface ExecutarReembolsoAgendadoResultado {
  /** `true` quando o dinheiro voltou (ou o gateway confirmou que já havia voltado). */
  executado: boolean;
  /** `true` quando falhou e ainda vai retentar; `false` quando foi para FALHOU. */
  vaiRetentar?: boolean;
  motivo?: string;
}

/**
 * Executa UM estorno agendado, chamando o gateway.
 *
 * ## O protocolo de três tempos, e por que ele não é opcional
 *
 * T1 (transação) lê a solicitação, confere que venceu e monta o que precisa.
 * T2 (**fora** de transação) chama o gateway.
 * T3 (transação) grava o desfecho.
 *
 * A chamada de rede NÃO pode acontecer dentro da transação: o `$transaction` do
 * Prisma tem timeout de 5s, e latência de gateway lá dentro vira rollback
 * silencioso — o pior resultado possível aqui, porque o dinheiro teria saído e o
 * banco não saberia.
 *
 * ## O que torna a retentativa segura
 *
 * A chave de idempotência é **ESTÁVEL**, derivada do id da solicitação. Uma
 * segunda chamada para a mesma solicitação não cria uma segunda devolução: o
 * Mercado Pago responde 409 `idempotency_key_already_used` e o adapter traduz em
 * `jaExistia: true`, que aqui conta como sucesso.
 *
 * ★ Sem essa chave, este caso de uso — chamado por um job que roda a cada 10
 * minutos — seria uma máquina de devolver dinheiro em dobro. É a mesma disciplina
 * de `EstornarPagamentoForaDaJanelaUseCase`.
 *
 * ## Estorno PARCIAL
 *
 * O valor devolvido é o da SOLICITAÇÃO (saldo residual do pacote), que é menor que
 * o pagamento original. Por isso `valor` vai preenchido: a Orders API trata corpo
 * vazio como estorno TOTAL, e um total aqui devolveria créditos que o cliente já
 * consumiu.
 */
@Injectable()
export class ExecutarReembolsoAgendadoUseCase {
  private readonly logger = new Logger(ExecutarReembolsoAgendadoUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async executar(input: {
    solicitacaoId: string;
    agora?: Date;
  }): Promise<ExecutarReembolsoAgendadoResultado> {
    const agora = input.agora ?? new Date();

    // ── T1: ler e validar ────────────────────────────────────────────────────
    const preparo = await this.uow.transacao(async (repos) => {
      const solicitacao = await repos.solicitacoesReembolso.porId(input.solicitacaoId);
      if (!solicitacao) return null;
      // Revalida o vencimento DENTRO da transação: entre a varredura do job e
      // este ponto, um admin pode ter cancelado o agendamento ou antecipado
      // outro. Confiar na lista do job seria agir sobre um estado que já mudou.
      if (!solicitacao.venceu(agora)) return null;

      const intencao = await repos.intencoesDePagamento.porReferenciaVendaDePacote(
        solicitacao.vendaDePacoteId,
      );
      if (!intencao || intencao.status !== StatusPagamento.PAGO || intencao.gatewayId === null) {
        return { semTransacao: true as const, solicitacao };
      }
      return {
        semTransacao: false as const,
        gatewayId: intencao.gatewayId,
        valor: solicitacao.valor,
      };
    });

    if (preparo === null) return { executado: false, motivo: 'não vencida ou inexistente' };

    if (preparo.semTransacao) {
      // Agendado sem transação online por trás. `AgendarReembolsoUseCase` recusa
      // isso, então chegar aqui significa que a intenção mudou depois (ou dado
      // antigo). Marcar FALHOU até o teto seria martelar o gateway sem alvo; o
      // caminho honesto é falhar já para o admin ver e devolver por fora.
      return this.registrarFalha(
        input.solicitacaoId,
        'Pacote sem transação online para estornar — devolva por fora e registre no admin.',
        agora,
      );
    }

    // ── T2: chamar o gateway, FORA de transação ──────────────────────────────
    let estornoId: string;
    let jaExistia: boolean;
    try {
      const r = await this.gateway.estornar({
        gatewayId: preparo.gatewayId,
        // Parcial: é o saldo residual, não o pagamento inteiro.
        valor: preparo.valor,
        // ★ ESTÁVEL. Ver o comentário do cabeçalho.
        idempotencyKey: chaveDeIdempotencia(input.solicitacaoId),
      });
      estornoId = r.estornoId;
      jaExistia = r.jaExistia ?? false;
    } catch (erro) {
      return this.registrarFalha(input.solicitacaoId, (erro as Error).message, agora);
    }

    // ── T3: gravar o desfecho ────────────────────────────────────────────────
    await this.uow.transacao(async (repos) => {
      const solicitacao = await repos.solicitacoesReembolso.porId(input.solicitacaoId);
      if (!solicitacao) return;
      const venda = await repos.vendasDePacote.porId(solicitacao.vendaDePacoteId);

      solicitacao.registrarEstornoExecutado(estornoId, agora);
      await repos.solicitacoesReembolso.salvar(solicitacao);

      // Move o saldo reservado para `saldoReembolsado` no pacote — o MESMO passo
      // que o fluxo manual faz em `ConfirmarReembolsoUseCase`. Sem ele, o saldo
      // ficaria eternamente "reservado" e o pacote continuaria oferecendo um
      // abatimento que o dinheiro já não cobre.
      //
      // ★ Tolerante a já-feito, mas SÓ a isso.
      //
      // Numa retentativa após falha de rede em que o gateway completou, o saldo
      // pode já ter sido movido — e aí não há reserva positiva para confirmar.
      // Esse caso é sucesso, e é detectado por PERGUNTA (`ehPositivo`), não por
      // `try/catch`.
      //
      // A diferença não é estilo. Um `catch` cego aqui engole também a violação
      // da invariante de soma do pacote — e o desfecho seria o pior possível:
      // solicitação marcada REEMBOLSADO, dinheiro devolvido pelo gateway, e o
      // saldo continuando reservado no pacote, oferecendo um abatimento que já
      // não existe. Foi exatamente o que o e2e pegou. Qualquer erro que não seja
      // "já movido" PRECISA derrubar a transação.
      if (venda && venda.saldoReservadoReembolso.ehPositivo()) {
        venda.confirmarReembolso();
        await repos.vendasDePacote.salvar(venda);
      } else if (venda) {
        this.logger.warn(
          `Saldo do pacote ${solicitacao.vendaDePacoteId} já estava movido — ` +
            'estorno registrado sem mexer nele (retentativa idempotente).',
        );
      }
    });

    this.logger.log(
      `Estorno da solicitação ${input.solicitacaoId} EXECUTADO — ${estornoId}` +
        (jaExistia ? ' (o gateway indicou que já havia sido aceito).' : '.'),
    );
    return { executado: true };
  }

  private async registrarFalha(
    solicitacaoId: string,
    erro: string,
    agora: Date,
  ): Promise<ExecutarReembolsoAgendadoResultado> {
    let vaiRetentar = false;
    await this.uow.transacao(async (repos) => {
      const solicitacao = await repos.solicitacoesReembolso.porId(solicitacaoId);
      if (!solicitacao) return;
      vaiRetentar = solicitacao.registrarFalhaNaExecucao(erro, agora);
      await repos.solicitacoesReembolso.salvar(solicitacao);
    });

    if (vaiRetentar) {
      this.logger.warn(`Estorno da solicitação ${solicitacaoId} falhou: ${erro}. Vai retentar.`);
    } else {
      // ERROR, não WARN: chegou ao teto de tentativas e PAROU. Dinheiro de
      // cliente que não voltou e agora depende de alguém abrir a tela — é o
      // cenário que `followup.md` #1 existia para não deixar acontecer em
      // silêncio.
      this.logger.error(
        `Estorno da solicitação ${solicitacaoId} DESISTIU após o teto de tentativas: ${erro}. ` +
          'Aparece na aba "Falhados" do admin e precisa de ação humana.',
      );
    }
    return { executado: false, vaiRetentar, motivo: erro };
  }
}

/**
 * Chave de idempotência do estorno de uma solicitação.
 *
 * Derivada só do id da solicitação — nada de timestamp, nada de contador. É
 * exatamente essa estabilidade que faz a retentativa não devolver duas vezes.
 *
 * Prefixo distinto do usado em `estornar-pagamento-fora-da-janela` (`estorno-`)
 * porque são devoluções DIFERENTES sobre a mesma order em potencial: uma é o
 * pagamento tardio inteiro, outra é o saldo residual parcial. Colidir a chave
 * faria a segunda ser silenciosamente ignorada pelo gateway.
 */
export function chaveDeIdempotencia(solicitacaoId: string): string {
  return `reembolso-${solicitacaoId}`;
}
