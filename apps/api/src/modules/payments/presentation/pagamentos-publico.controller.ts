import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PagarComCartaoResponse } from '@bigods/contracts';
import { Publico } from '../../identity/presentation/auth.decorators';
import { PagarComCartaoUseCase } from '../application/pagar-com-cartao.usecase';

/**
 * Corpo de `POST /public/pagamentos/:intencaoId/cartao`.
 *
 * ★ NÃO EXISTE campo de dinheiro aqui, e isso é a proteção — não o
 * `ValidationPipe`. O `whitelist: true` descarta propriedade desconhecida, mas
 * quem garante que o cliente não escolhe o preço é a AUSÊNCIA do campo: o valor
 * vem da `IntencaoDePagamento` persistida.
 *
 * Se alguém acrescentar `amount`, `valorCentavos` ou `installments` aqui, abre
 * exatamente o "assinar um valor e pagar outro" que o dono pediu para impedir.
 */
class PagarComCartaoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  companyId!: string;

  /**
   * Token do cartão, gerado no BROWSER pelo MercadoPago.js. O PAN nunca chega ao
   * backend — é o que mantém a integração no escopo mínimo de PCI.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;

  /** Bandeira (`master`, `visa`, `elo`…), que o SDK deduz do BIN. */
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  paymentMethodId!: string;

  /** `MP_DEVICE_SESSION_ID` do antifraude, se o SDK o coletou. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deviceId?: string;
}

/**
 * Quantas cobranças de cartão uma MESMA origem pode disparar por 10 minutos.
 *
 * Dimensionado para uso real (o cliente tenta 1–3 cartões numa janela de 30 min) e
 * para cortar teste de cartões em massa pela raiz. Configurável pelo MESMO motivo
 * do limite de OTP: operadoras móveis usam CGNAT, e muitos clientes legítimos
 * podem sair pelo mesmo IP público — se aparecer 429 em cliente de verdade, sobe.
 *
 * **Nunca desligue.** Este é o único limite entre um `intencaoId` vazado e uma
 * bateria de tentativas contra a nossa conta no gateway. Um valor ≤ 0 é ignorado e
 * cai no padrão, para que um `.env` mal preenchido não abra a porta.
 *
 * Lido a cada requisição, não no import: os `import` dos testes são içados para
 * antes do setup do ambiente, então um valor lido no import ignoraria o `.env` de
 * teste.
 */
export function limiteCartaoPorOrigem(): number {
  const bruto = Number(process.env.CARTAO_LIMITE_POR_ORIGEM ?? '');
  return Number.isInteger(bruto) && bruto > 0 ? bruto : 10;
}

/**
 * Superfície pública de pagamento com cartão.
 *
 * ## Por que o prefixo `/public/pagamentos` não é escolha estética
 *
 * `ROTAS_COM_CORPO_SENSIVEL`, em `packages/contracts/src/sentry-scrubbing.ts`, já
 * contém `/public/pagamentos`. É a rota que decide se o corpo vai para o Sentry —
 * não o conteúdo. Se este endpoint nascesse sob `/public/agendamentos`, o token do
 * cartão iria inteiro para o painel de erros no primeiro `500`.
 *
 * ## Montagem condicional
 *
 * Só existe com `PAYMENT_GATEWAY=mercadopago`: é o único gateway que cobra cartão
 * nesta integração. Com `abacatepay` ou `fake`, a rota simplesmente não existe —
 * melhor que responder 501 numa rota anunciada.
 */
@Controller('public/pagamentos')
export class PagamentosPublicoController {
  constructor(private readonly pagarComCartao: PagarComCartaoUseCase) {}

  /**
   * Cobra o cartão de uma intenção existente.
   *
   * Desfechos possíveis, todos em 2xx: `APROVADO`, `EM_ANALISE`, `DESAFIO_3DS`
   * (com a URL do iframe) e `RECUSADO` (com motivo vago). Recusa de cartão é
   * desfecho de negócio, não erro de protocolo.
   *
   * Erros de verdade: **404** se a intenção não existe ou é de outra empresa
   * (genérico de propósito — 403 confirmaria a existência do id), **409** se a
   * janela expirou ou já há tentativa em andamento, **503** se a operadora não
   * respondeu.
   *
   * O throttle é por ORIGEM (IP). Um throttle por `intencaoId` seria mais
   * apertado — quem vazar o id de uma intenção pode queimá-la com tentativas —
   * mas exige tracker próprio no Throttler; está registrado em `followup.md`.
   */
  @Publico()
  @Throttle({ default: { limit: () => limiteCartaoPorOrigem(), ttl: 600_000 } })
  @Post(':intencaoId/cartao')
  async cartao(
    @Param('intencaoId') intencaoId: string,
    @Body() dto: PagarComCartaoDto,
  ): Promise<PagarComCartaoResponse> {
    return this.pagarComCartao.executar({
      companyId: dto.companyId,
      // O id vem do PATH, nunca da query string: query aparece em log de acesso e
      // em `Referer`, e este id é a capability do fluxo.
      intencaoId,
      token: dto.token,
      paymentMethodId: dto.paymentMethodId,
      ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
    });
  }
}
