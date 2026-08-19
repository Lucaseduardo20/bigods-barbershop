import { Inject, Injectable, Logger } from '@nestjs/common';
import { CobrancaDTO, PagamentoManualDTO } from '@bigods/contracts';
import { PAYMENT_GATEWAY, PaymentGateway } from '../domain/payment-gateway';
import { IntencaoDePagamento } from '../domain/intencao-de-pagamento.aggregate';
import { DadosDaComanda, linkDaComanda, montarComanda } from '../domain/comanda-whatsapp';
import {
  CONFIG_PAGAMENTO_MANUAL,
  ConfigPagamentoManual,
} from '../../../shared/config/pagamento-manual';

export interface ResultadoDaCobranca {
  /** PIX do gateway. `null` quando o modo manual está ligado. */
  cobranca: CobrancaDTO | null;
  /** Ponte do WhatsApp. `null` no modo normal (gateway). */
  pagamentoManual: PagamentoManualDTO | null;
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
  ) {}

  /** true quando o funil deve mandar o cliente ao WhatsApp em vez de mostrar QR. */
  get manualAtivo(): boolean {
    return this.config.ativo;
  }

  async gerar(params: {
    intencao: IntencaoDePagamento;
    /** Descrição enviada ao gateway (ignorada no modo manual). */
    descricao: string;
    /** Prazo pedido ao gateway; o `expiraEm` da intenção já foi calculado com ele. */
    expiraEmSegundos?: number;
    /** Dados legíveis do pedido, para a comanda do WhatsApp. */
    comanda: DadosDaComanda;
  }): Promise<ResultadoDaCobranca> {
    if (this.config.ativo) {
      const texto = montarComanda(params.comanda);
      this.logger.log(
        `Pagamento MANUAL (WhatsApp) para a intenção ${params.intencao.id} — nenhum PIX gerado`,
      );
      return {
        cobranca: null,
        pagamentoManual: {
          intencaoId: params.intencao.id,
          whatsappUrl: linkDaComanda(this.config.whatsappNumero, texto),
          comanda: texto,
          expiraEm: params.intencao.expiraEm?.toISOString() ?? null,
        },
      };
    }

    const pix = await this.gateway.criarCobrancaPix({
      valor: params.intencao.valor,
      descricao: params.descricao,
      externalId: params.intencao.externalId,
      ...(params.expiraEmSegundos ? { expiraEmSegundos: params.expiraEmSegundos } : {}),
    });
    return {
      cobranca: {
        intencaoId: params.intencao.id,
        qrCode: pix.qrCode,
        copiaECola: pix.copiaECola,
        expiraEm: params.intencao.expiraEm!.toISOString(),
      },
      pagamentoManual: null,
    };
  }
}
