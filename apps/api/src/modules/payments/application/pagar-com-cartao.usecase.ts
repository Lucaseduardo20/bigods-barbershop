import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MotivoPublicoDaRecusa,
  PagarComCartaoResponse,
  ResultadoDoCartao,
  StatusPagamento,
} from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { CobrancaDeCartao, PAYMENT_GATEWAY, PaymentGateway } from '../domain/payment-gateway';
import { TentativaDePagamento } from '../domain/tentativa-de-pagamento.aggregate';
import {
  motivoPublicoDaRecusa,
  podeTentarOutroCartao,
} from '../domain/motivo-publico-da-recusa';
import { ProcessarWebhookUseCase } from './processar-webhook.usecase';

/**
 * Cobra um cartão de crédito à vista para uma `IntencaoDePagamento` que JÁ existe.
 *
 * ## As travas de segurança, e o que cada uma impede
 *
 * 1. **Nenhum valor vem do cliente.** O `input` não tem campo de dinheiro; o
 *    valor sai de `intencao.valor`, relida do banco. É o pedido literal do dono:
 *    o usuário não pode "assinar um valor e pagar outro".
 * 2. **404 genérico em divergência de `companyId`**, nunca 403 — um 403
 *    confirmaria que aquele `intencaoId` existe.
 * 3. **Uma tentativa viva por vez.** Sem isso, dois cartões poderiam aprovar e a
 *    barbearia cobraria duas vezes. Vale também durante um desafio 3DS pendente.
 * 4. **A janela NÃO é renovada.** Quem gastou 10 dos 30 minutos tem 20 — decisão
 *    do dono. Passou do prazo, a intenção expira aqui mesmo e a cobrança é
 *    recusada.
 * 5. **Chave de idempotência nova por tentativa, persistida.** Cada tentativa é
 *    uma order nova no Mercado Pago; reenviar chave dá 409, não replay.
 *
 * ## A ordem das operações
 *
 * T1 (transação) valida e ABRE a tentativa. T2 (fora) chama o gateway. T3
 * (transação) fecha a tentativa e aplica o desfecho. A chamada nunca acontece
 * dentro da transação: o `$transaction` do Prisma tem timeout de 5s e latência de
 * rede lá dentro vira rollback silencioso.
 */
@Injectable()
export class PagarComCartaoUseCase {
  private readonly logger = new Logger(PagarComCartaoUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly processarWebhook: ProcessarWebhookUseCase,
  ) {}

  async executar(input: {
    companyId: string;
    intencaoId: string;
    token: string;
    paymentMethodId: string;
    deviceId?: string;
    agora?: Date;
  }): Promise<PagarComCartaoResponse> {
    const agora = input.agora ?? new Date();

    // ── T1: validar e abrir a tentativa ──────────────────────────────────────
    const preparo = await this.comConflitoDeTentativaViva(() =>
      this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porId(input.intencaoId);
      // 404 genérico também quando a company não bate: 403 confirmaria a
      // existência do id, e o `intencaoId` é a capability deste fluxo.
      if (!intencao || intencao.companyId !== input.companyId) {
        throw new NotFoundException('Intenção de pagamento não encontrada');
      }

      if (intencao.status === StatusPagamento.PAGO) {
        // Idempotente e amigável: repetir um pagamento aprovado não é erro.
        return { jaPago: true as const, expirou: false as const, expiraEm: intencao.expiraEm };
      }

      // A janela não renova. Estourou, expira e recusa.
      //
      // ★ O `return` é essencial, e um `throw` aqui era um BUG: lançar de dentro
      // de `uow.transacao` faz o Prisma dar rollback, e o `expirar()` acima seria
      // descartado junto — a intenção continuaria AGUARDANDO, o polling do funil
      // mostraria "reservado" por mais 30 minutos, e o código diria uma coisa
      // enquanto o banco guardava outra. Sai com o dado gravado; o 409 vem depois
      // do commit.
      if (intencao.expirouPorTempo(agora)) {
        intencao.expirar();
        await repos.intencoesDePagamento.salvar(intencao);
        return { jaPago: false as const, expirou: true as const };
      }
      if (
        intencao.status === StatusPagamento.EXPIRADO ||
        intencao.status === StatusPagamento.EM_ANALISE
      ) {
        throw new ConflictException(
          `Pagamento em ${intencao.status} — não é possível iniciar uma cobrança nova agora.`,
        );
      }

      // Uma tentativa viva por vez. Cobre o desafio 3DS em curso: ali o status da
      // intenção segue AGUARDANDO, mas a tentativa está viva.
      //
      // ★ Esta leitura é a mensagem BOA, não a trava. Quem realmente garante o
      // invariante é o índice parcial único
      // `TentativaDePagamento_uma_viva_por_intencao`
      // (`20260827030000_tentativa_viva_unica`): sob dois POST simultâneos, ambas
      // as transações leem zero tentativas vivas aqui e ambas seguem — foi medido
      // no e2e, com DUAS orders criadas no gateway para o mesmo agendamento. O
      // `catch` de `P2002` lá embaixo é o que fecha a corrida.
      const tentativas = await repos.tentativasDePagamento.porIntencao(input.intencaoId);
      if (tentativas.some((t) => t.estaViva())) {
        throw new ConflictException(
          'Já existe uma tentativa de pagamento em andamento para esta cobrança.',
        );
      }

      const tentativa = TentativaDePagamento.iniciar({
        id: randomUUID(),
        companyId: intencao.companyId,
        intencaoDePagamentoId: intencao.id,
        gateway: this.gateway.provedor,
        // Chave NOVA por tentativa, persistida com índice @unique: é assim que
        // "nunca reutilizar" deixa de ser convenção e passa a ser invariante.
        idempotencyKey: randomUUID(),
        meio: 'CARTAO_CREDITO',
        agora,
      });
      await repos.tentativasDePagamento.salvar(tentativa);

      return {
        jaPago: false as const,
        expirou: false as const,
        tentativaId: tentativa.id,
        idempotencyKey: tentativa.idempotencyKey,
        externalId: intencao.externalId,
        valor: intencao.valor,
        expiraEm: intencao.expiraEm,
      };
      }),
    );

    if (preparo.expirou) {
      // (o `throw` fica aqui, fora da transação — ver o comentário em `expirou`)
      throw new ConflictException(
        'A janela de pagamento expirou. Refaça o agendamento para tentar de novo.',
      );
    }

    if (preparo.jaPago) {
      return {
        intencaoId: input.intencaoId,
        resultado: ResultadoDoCartao.APROVADO,
        podeTentarNovamente: false,
        expiraEm: preparo.expiraEm?.toISOString() ?? null,
      };
    }

    // ── T2: cobrar, FORA de transação ────────────────────────────────────────
    let cobranca: CobrancaDeCartao;
    try {
      cobranca = await this.gateway.pagarComCartao({
        valor: preparo.valor,
        descricao: `Pagamento ${preparo.externalId}`,
        externalId: preparo.externalId,
        token: input.token,
        paymentMethodId: input.paymentMethodId,
        idempotencyKey: preparo.idempotencyKey,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      });
    } catch (erro) {
      const mensagem = (erro as Error).message;
      // A tentativa morre, a INTENÇÃO não. Numa falha de rede a order pode ter
      // sido criada do lado deles, e marcar a intenção como FALHOU aqui alegaria
      // um desfecho que não conhecemos. Quem resolve é o webhook (que acha a
      // intenção pelo `external_reference`) ou o job de reconciliação.
      await this.uow.transacao(async (repos) => {
        const tentativa = await repos.tentativasDePagamento.porId(preparo.tentativaId);
        if (!tentativa) return;
        tentativa.marcarFalhaSemOrder(mensagem, agora);
        await repos.tentativasDePagamento.salvar(tentativa);
      });
      this.logger.error(
        `Cobrança de cartão da intenção ${input.intencaoId} não completou: ${mensagem}. ` +
          'Intenção permanece AGUARDANDO — o webhook ou a reconciliação decidem.',
      );
      throw new ServiceUnavailableException(
        'Não conseguimos falar com a operadora agora. Tente novamente em instantes.',
      );
    }

    // ── T3: fechar a tentativa e aplicar o desfecho ──────────────────────────
    if (cobranca.desfecho.tipo === 'REVISAO_MANUAL') {
      // Não deveria acontecer numa cobrança recém-criada (é o vocabulário de
      // estorno/chargeback). Se acontecer, não inventamos estado: registra e
      // devolve recusa genérica.
      await this.fecharTentativa(preparo.tentativaId, cobranca, StatusPagamento.FALHOU, agora);
      this.logger.error(
        `Cobrança da intenção ${input.intencaoId} voltou em revisão manual ` +
          `(${cobranca.desfecho.motivo}) — revisar no admin.`,
      );
      return {
        intencaoId: input.intencaoId,
        resultado: ResultadoDoCartao.RECUSADO,
        motivoPublico: MotivoPublicoDaRecusa.GENERICO,
        podeTentarNovamente: true,
        expiraEm: preparo.expiraEm?.toISOString() ?? null,
      };
    }

    const status = cobranca.desfecho.status;
    await this.fecharTentativa(preparo.tentativaId, cobranca, status, agora);

    if (status === StatusPagamento.PAGO) {
      // Delega ao caminho ÚNICO de confirmação — o mesmo do webhook e da
      // confirmação manual do admin. É ele que libera pacote/atendimento.
      await this.processarWebhook.executar({
        externalId: preparo.externalId,
        ...(cobranca.valorPago === null ? {} : { valorPagoCentavos: cobranca.valorPago.centavos }),
        statusDetalhe: cobranca.statusDetalheBruto,
        valorLiquidoCentavos: cobranca.valorLiquido?.centavos ?? null,
      });
      return {
        intencaoId: input.intencaoId,
        resultado: ResultadoDoCartao.APROVADO,
        podeTentarNovamente: false,
        expiraEm: preparo.expiraEm?.toISOString() ?? null,
      };
    }

    await this.aplicarNaIntencao(input.intencaoId, cobranca, status);

    // Desafio 3DS: o status da intenção segue AGUARDANDO de propósito — o cliente
    // ainda tem ação a tomar e a janela continua correndo.
    if (cobranca.urlDoDesafio3ds) {
      return {
        intencaoId: input.intencaoId,
        resultado: ResultadoDoCartao.DESAFIO_3DS,
        urlDoDesafio3ds: cobranca.urlDoDesafio3ds,
        podeTentarNovamente: false,
        expiraEm: preparo.expiraEm?.toISOString() ?? null,
      };
    }

    if (status === StatusPagamento.EM_ANALISE) {
      return {
        intencaoId: input.intencaoId,
        resultado: ResultadoDoCartao.EM_ANALISE,
        podeTentarNovamente: false,
        expiraEm: preparo.expiraEm?.toISOString() ?? null,
      };
    }

    return {
      intencaoId: input.intencaoId,
      resultado: ResultadoDoCartao.RECUSADO,
      // ★ Enum vago. O `status_detail` cru fica no banco, visível só no admin —
      // devolvê-lo aqui ensinaria o fraudador a calibrar a próxima tentativa.
      motivoPublico: motivoPublicoDaRecusa(cobranca.statusDetalheBruto),
      podeTentarNovamente: podeTentarOutroCartao(cobranca.statusDetalheBruto),
      expiraEm: preparo.expiraEm?.toISOString() ?? null,
    };
  }

  /**
   * Traduz a violação do índice parcial único de "uma tentativa viva por
   * intenção" num **409 legível**, em vez de deixar vazar um 500 do Prisma.
   *
   * ## Por que existe
   *
   * O `if` de "existe tentativa viva?" dentro da transação não segura concorrência
   * — o e2e mediu dois POST simultâneos criando DUAS orders no Mercado Pago para o
   * mesmo agendamento, o que com `capture_mode: automatic` é o cliente pagando
   * duas vezes. A trava de verdade é o índice
   * `TentativaDePagamento_uma_viva_por_intencao`. Este método é o que faz a trava
   * do banco falar a mesma língua da checagem da aplicação: as duas respondem 409
   * com a mesma frase, e o cliente que clicou duas vezes não vê um erro genérico.
   *
   * ## Como o P2002 é identificado, e a armadilha que isso esconde
   *
   * Casa por MODELO + COLUNAS, e não por "é P2002": a tabela tem outros dois
   * únicos (`idempotencyKey` e `[gateway, gatewayId]`), e colisão neles significa
   * outra coisa — reutilização de chave de idempotência, ou reapontamento de
   * order — que não pode ser mascarada como "já tem cobrança em andamento".
   *
   * ★ `meta.target` traz as **colunas**, NUNCA o nome do índice. Verificado
   * empiricamente contra o Postgres real:
   *
   *     { modelName: 'TentativaDePagamento', target: ['intencaoDePagamentoId'] }
   *
   * A primeira versão deste método procurava o nome do índice
   * (`uma_viva_por_intencao`) em `meta.target` e portanto **nunca casava** — o
   * P2002 escapava e o cliente recebia 500. Passou despercebido porque o e2e
   * afirmava `status >= 400`, e 500 satisfaz isso; só um `toBe(409)` pegou.
   */
  private async comConflitoDeTentativaViva<T>(operacao: () => Promise<T>): Promise<T> {
    try {
      return await operacao();
    } catch (erro) {
      const e = erro as { code?: string; meta?: { modelName?: string; target?: unknown } };
      const alvo = e.meta?.target;
      const ehTentativaViva =
        e.meta?.modelName === 'TentativaDePagamento' &&
        Array.isArray(alvo) &&
        alvo.length === 1 &&
        alvo[0] === 'intencaoDePagamentoId';
      if (e.code === 'P2002' && ehTentativaViva) {
        this.logger.warn(
          `Corrida de cobrança na intenção — o índice parcial recusou a segunda tentativa. ` +
            'É o caminho esperado para duplo clique / duplo POST.',
        );
        throw new ConflictException(
          'Já existe uma tentativa de pagamento em andamento para esta cobrança.',
        );
      }
      throw erro;
    }
  }

  private async fecharTentativa(
    tentativaId: string,
    cobranca: CobrancaDeCartao,
    status: StatusPagamento,
    agora: Date,
  ): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const tentativa = await repos.tentativasDePagamento.porId(tentativaId);
      if (!tentativa) return;
      tentativa.concluir({
        gatewayId: cobranca.gatewayId,
        status,
        statusDetalhe: cobranca.statusDetalheBruto,
        valorLiquido: cobranca.valorLiquido,
        agora,
      });
      await repos.tentativasDePagamento.salvar(tentativa);
    });
  }

  /** Aplica EM_ANALISE / FALHOU / detalhe na intenção. PAGO passa pelo webhook. */
  private async aplicarNaIntencao(
    intencaoId: string,
    cobranca: CobrancaDeCartao,
    status: StatusPagamento,
  ): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const intencao = await repos.intencoesDePagamento.porId(intencaoId);
      if (!intencao) return;

      intencao.registrarStatusDetalhe(cobranca.statusDetalheBruto);
      // Grava o vínculo com a order desta tentativa, se a intenção ainda não tem
      // um: é a chave que o webhook vai devolver.
      if (intencao.gatewayId === null) {
        intencao.vincularAoGateway(this.gateway.provedor, cobranca.gatewayId);
      }
      if (cobranca.valorLiquido !== null) {
        intencao.registrarValorLiquido(cobranca.valorLiquido);
      }
      if (status === StatusPagamento.EM_ANALISE) {
        intencao.marcarEmAnalise();
      }
      // ★ Cartão RECUSADO **não** mexe no status da intenção — e isto é a
      // correção de um bug medido, não uma sutileza.
      //
      // Quem falhou foi a TENTATIVA, e é ela que já está FALHOU no banco. A
      // intenção continua AGUARDANDO porque é literalmente o que ela é: a janela
      // de 30 minutos segue correndo e o cliente pode tentar outro cartão (decisão
      // do dono). Marcar a intenção como FALHOU aqui — o que este código fazia —
      // produzia dois defeitos encadeados:
      //
      //   1. a SEGUNDA tentativa estourava 422, porque `marcarFalha()` recusava
      //      FALHOU → FALHOU. O cliente com um cartão recusado ficava sem saída.
      //   2. pior: se a segunda tentativa fosse APROVADA,
      //      `confirmarPagamento` recusava FALHOU → PAGO — dinheiro capturado no
      //      emissor e agendamento não confirmado.
      //
      // Os dois foram fechados (a máquina de estado ficou idempotente e aceita
      // FALHOU → PAGO), mas a raiz era esta: confundir tentativa com intenção. É
      // exatamente a distinção que `TentativaDePagamento` existe para manter.
      //
      // Quem leva a intenção a FALHOU de fato é o caminho terminal: o webhook com
      // uma order `failed`, ou a expiração por tempo.
      await repos.intencoesDePagamento.salvar(intencao);
    });
  }
}
