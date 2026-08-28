import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { CheckoutCartaoDTO, CobrancaDTO, PagamentoManualDTO } from '@bigods/contracts';
import type { MeioDePagamentoOnline } from '@bigods/contracts';
import { PAYMENT_GATEWAY, PaymentGateway } from '../domain/payment-gateway';
import { IntencaoDePagamento } from '../domain/intencao-de-pagamento.aggregate';
import { DadosDaComanda, linkDaComanda, montarComanda } from '../domain/comanda-whatsapp';
import {
  CONFIG_PAGAMENTO_MANUAL,
  ConfigPagamentoManual,
} from '../../../shared/config/pagamento-manual';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';

export interface ResultadoDaCobranca {
  /** PIX do gateway. `null` no modo manual e no trilho de cartão. */
  cobranca: CobrancaDTO | null;
  /** Ponte do WhatsApp. `null` no modo normal (gateway). */
  pagamentoManual: PagamentoManualDTO | null;
  /**
   * Trilho de cartão: nada foi cobrado ainda, o funil vai montar o formulário e
   * chamar `POST /public/pagamentos/:intencaoId/cartao`. `null` nos outros modos.
   */
  checkoutCartao: CheckoutCartaoDTO | null;
}

/**
 * ★ O ÚNICO ponto do sistema que decide COMO a cobrança online acontece.
 *
 * Modo normal: PIX pelo gateway (AbacatePay), como sempre.
 * Modo manual (`PAGAMENTO_MANUAL_WHATSAPP=true`, TEMPORÁRIO enquanto o
 * AbacatePay não libera produção): nenhum PIX é gerado; o cliente é mandado
 * pro WhatsApp da barbearia com a comanda pronta, e o dono confirma o
 * pagamento no admin quando o PIX cair por fora.
 *
 * A flag vive AQUI e em nenhum outro lugar do fluxo de compra. Os casos de uso
 * (`VenderPacoteUseCase`, `AgendarAvulsoUseCase`) chamam este serviço no mesmo
 * ponto em que antes chamavam o gateway direto — tudo o que vem antes é
 * idêntico nos dois modos, de propósito:
 *
 *  - a `IntencaoDePagamento` é criada igual, com o MESMO `expiraEm`;
 *  - a reserva do horário (avulso online) nasce igual, `RESERVADO` e com prazo;
 *  - a expiração por timeout (`ExpirarPagamentoVencidoUseCase`) segue valendo.
 *
 * Isso é o que impede o buraco de agenda: cliente que clica "pagar", vai pro
 * WhatsApp e some NÃO prende o horário — ele expira sozinho, exatamente como no
 * fluxo com PIX de verdade. Nada disso é código novo: é o mesmo mecanismo,
 * só sem a chamada ao gateway.
 *
 * Voltar ao normal é virar a env var — o código do gateway continua intacto.
 */
@Injectable()
export class CobrancaOnlineService {
  private readonly logger = new Logger(CobrancaOnlineService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(CONFIG_PAGAMENTO_MANUAL) private readonly config: ConfigPagamentoManual,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  /** true quando o funil deve mandar o cliente ao WhatsApp em vez de mostrar QR. */
  get manualAtivo(): boolean {
    return this.config.ativo;
  }

  /**
   * Meios online que este deploy aceita — o que o funil usa para desenhar a tela.
   *
   * Modo manual não aceita nenhum (a lista vazia é o sinal de "vai pelo
   * WhatsApp"). Cartão só existe onde o gateway ativo sabe cobrar cartão, e essa
   * pergunta é do adapter, não desta camada: quem não implementa `pagarComCartao`
   * declara `suportaCartao = false` na porta.
   */
  get meiosDisponiveis(): MeioDePagamentoOnline[] {
    if (this.config.ativo) return [];
    return this.gateway.suportaCartao ? ['PIX', 'CARTAO_CREDITO'] : ['PIX'];
  }

  /**
   * Recusa um trilho que este deploy não aceita — chamado no INÍCIO dos casos de
   * uso de compra, antes de qualquer escrita.
   *
   * ★ A posição importa mais que a checagem. Recusar só na hora de cobrar (lá
   * embaixo, em `gerar`) já teria criado o `Atendimento`, gravado a
   * `IntencaoDePagamento` e RESERVADO o horário — e a exceção deixaria esse
   * horário preso até expirar, por um erro de cliente. Falhar antes de escrever
   * não custa nada.
   */
  assertMeioSuportado(meio: MeioDePagamentoOnline | undefined): void {
    if (!meio) return; // ausente = PIX, que é sempre o trilho base
    if (!this.meiosDisponiveis.includes(meio)) {
      throw new BadRequestException(
        `Este estabelecimento não aceita ${meio === 'CARTAO_CREDITO' ? 'cartão de crédito' : 'PIX'} online agora.`,
      );
    }
  }

  async gerar(params: {
    intencao: IntencaoDePagamento;
    /** Descrição enviada ao gateway (ignorada no modo manual). */
    descricao: string;
    /** Prazo pedido ao gateway; o `expiraEm` da intenção já foi calculado com ele. */
    expiraEmSegundos?: number;
    /** Dados legíveis do pedido, para a comanda do WhatsApp. */
    comanda: DadosDaComanda;
    /**
     * E-mail do cliente, quando ele informou. A AbacatePay ignora; o Mercado
     * Pago EXIGE `payer.email` e cai no padrão configurado se vier vazio.
     */
    emailDoPagador?: string;
    /**
     * Trilho escolhido pelo cliente. Ausente = `'PIX'`, que é o comportamento de
     * sempre — nenhum chamador antigo muda de significado.
     */
    meio?: MeioDePagamentoOnline;
  }): Promise<ResultadoDaCobranca> {
    if (this.config.ativo) {
      const texto = montarComanda(params.comanda);
      this.logger.log(
        `Pagamento MANUAL (WhatsApp) para a intenção ${params.intencao.id} — nenhum PIX gerado`,
      );
      return {
        cobranca: null,
        checkoutCartao: null,
        pagamentoManual: {
          intencaoId: params.intencao.id,
          whatsappUrl: linkDaComanda(this.config.whatsappNumero, texto),
          comanda: texto,
          expiraEm: params.intencao.expiraEm?.toISOString() ?? null,
        },
      };
    }

    if ((params.meio ?? 'PIX') === 'CARTAO_CREDITO') {
      // ★ NENHUMA chamada ao gateway aqui, e é o ponto todo do trilho.
      //
      // A order de cartão nasce em `PagarComCartaoUseCase`, uma por tentativa,
      // com chave de idempotência própria. Se criássemos um PIX aqui "por
      // garantia", a intenção passaria a ter dois caminhos de pagamento vivos ao
      // mesmo tempo — o cliente poderia pagar o PIX e ter o cartão aprovado, e a
      // trava de "uma tentativa viva por vez" só olha tentativas de cartão.
      if (!this.gateway.suportaCartao) {
        // Não deveria chegar aqui: a borda (`AgendarPublicoDto`) recusa o meio
        // que o deploy não anuncia. Recusar de novo aqui é barato e impede que
        // uma futura chamada interna escolha um trilho inexistente.
        throw new Error(
          `Gateway ${this.gateway.provedor} não cobra cartão — meio CARTAO_CREDITO indisponível neste deploy.`,
        );
      }
      this.logger.log(
        `Checkout de CARTÃO para a intenção ${params.intencao.id} — nenhuma order criada ainda`,
      );
      // Grava o TRILHO, mesmo sem order: é o que faz a conclusão do atendimento
      // registrar `FormaPagamento.CARTAO_CREDITO` em vez de `PIX_ONLINE`
      // (`followup.md` #13). Relê dentro da transação pela mesma razão do write de
      // `vincularAoGateway` abaixo — um webhook concorrente não pode ser
      // sobrescrito por uma instância antiga em memória.
      await this.uow.transacao(async (repos) => {
        const atual = await repos.intencoesDePagamento.porId(params.intencao.id);
        if (!atual) return;
        atual.registrarMeio('CARTAO_CREDITO');
        await repos.intencoesDePagamento.salvar(atual);
      });
      return {
        cobranca: null,
        pagamentoManual: null,
        checkoutCartao: {
          intencaoId: params.intencao.id,
          expiraEm: params.intencao.expiraEm!.toISOString(),
        },
      };
    }

    const pix = await this.gateway.criarCobrancaPix({
      valor: params.intencao.valor,
      descricao: params.descricao,
      externalId: params.intencao.externalId,
      ...(params.expiraEmSegundos ? { expiraEmSegundos: params.expiraEmSegundos } : {}),
      ...(params.emailDoPagador ? { emailDoPagador: params.emailDoPagador } : {}),
    });

    // ★ Grava QUEM criou a cobrança e o id dela no gateway.
    //
    // Segundo write, de propósito: a chamada HTTP acima acontece FORA de
    // transação (o `$transaction` do Prisma tem timeout de 5s, e latência de
    // rede lá dentro vira rollback silencioso). Então a intenção já foi salva
    // antes, e o vínculo é gravado agora.
    //
    // A corrida óbvia — o webhook chegar ANTES deste write — está coberta: o
    // Mercado Pago ecoa o nosso `external_reference` na resposta do
    // `GET /v1/orders/{id}`, e é por ele que `ProcessarWebhookMercadoPagoUseCase`
    // procura primeiro. O `gatewayId` é o plano B, não o caminho principal.
    //
    // Relê dentro da transação em vez de salvar a instância que temos em mão:
    // se o webhook já confirmou o pagamento nesse meio-tempo, gravar a instância
    // antiga sobrescreveria PAGO de volta para AGUARDANDO.
    await this.uow.transacao(async (repos) => {
      const atual = await repos.intencoesDePagamento.porId(params.intencao.id);
      if (!atual) return;
      atual.vincularAoGateway(this.gateway.provedor, pix.gatewayId);
      atual.registrarMeio('PIX');
      await repos.intencoesDePagamento.salvar(atual);
    });

    return {
      cobranca: {
        intencaoId: params.intencao.id,
        qrCode: pix.qrCode,
        copiaECola: pix.copiaECola,
        expiraEm: params.intencao.expiraEm!.toISOString(),
      },
      pagamentoManual: null,
      checkoutCartao: null,
    };
  }
}
