import { Logger, Module } from '@nestjs/common';
import { WebhooksController } from './presentation/webhooks.controller';
import { AbacatePayWebhookGuard } from './presentation/abacatepay-webhook.guard';
import { ProcessarWebhookUseCase } from './application/processar-webhook.usecase';
import { ExpirarPagamentoVencidoUseCase } from './application/expirar-pagamento-vencido.usecase';
import { PAYMENT_GATEWAY, PaymentGateway } from './domain/payment-gateway';
import { FakeAbacatePayGateway } from './infrastructure/fake-abacatepay.gateway';
import { AbacatePayGateway } from './infrastructure/abacatepay.gateway';
import { CobrancaOnlineService } from './application/cobranca-online.service';
import {
  CONFIG_PAGAMENTO_MANUAL,
  lerConfigPagamentoManual,
} from '../../shared/config/pagamento-manual';
import { PagamentoStatusQueryService } from './infrastructure/pagamento-status-query.service';
import { CONFIG_MERCADO_PAGO, lerConfigMercadoPago } from '../../shared/config/mercadopago';
import {
  CONFIG_COMISSAO_LIQUIDA,
  lerConfigComissaoLiquida,
} from '../../shared/config/comissao-liquida';
import { MercadoPagoGateway } from './infrastructure/mercadopago.gateway';
import { MercadoPagoWebhookController } from './presentation/mercadopago-webhook.controller';
import { MercadoPagoWebhookGuard } from './presentation/mercadopago-webhook.guard';
import { ProcessarWebhookMercadoPagoUseCase } from './application/processar-webhook-mercadopago.usecase';
import { EstornarPagamentoForaDaJanelaUseCase } from './application/estornar-pagamento-fora-da-janela.usecase';
import { ReconciliarPagamentosJob } from './infrastructure/reconciliar-pagamentos.job';
import { PagarComCartaoUseCase } from './application/pagar-com-cartao.usecase';
import { PagamentosPublicoController } from './presentation/pagamentos-publico.controller';

const EXPIRA_PADRAO_SEGUNDOS = 3600;

/**
 * Adapter ativo por variável de ambiente (mesmo padrão do IdentityProvider).
 * Default: `abacatepay` em produção, `fake` em dev/test. Esta factory é o ÚNICO
 * ponto que conhece os dois adapters — trocar fake↔abacatepay é só a env, zero
 * mudança de domínio/aplicação.
 */
export type AdapterDePagamento = 'abacatepay' | 'mercadopago' | 'fake';

/**
 * Adapter ativo, FAIL CLOSED.
 *
 * Antes (até 2026-08-26) isto era um ternário que colapsava QUALQUER valor
 * desconhecido em `fake`. Com dois gateways reais a conviver, esse fallback
 * silencioso virou perigoso: um `PAYMENT_GATEWAY=mercadopagoo` (typo) ou
 * `=mercado_pago` subiria a aplicação sem cobrança online nenhuma, e o dono
 * descobriria no primeiro cliente que tentasse pagar. Valor desconhecido agora
 * derruba o boot — é o mesmo princípio de `PROVIDERS_VALIDOS_EM_PRODUCAO` em
 * `config-seguranca.ts`, e o anti-padrão "fallback silencioso" do CLAUDE.md.
 */
export function gatewayAtivo(): AdapterDePagamento {
  const padrao = process.env.NODE_ENV === 'production' ? 'abacatepay' : 'fake';
  const valor = (process.env.PAYMENT_GATEWAY ?? padrao).toLowerCase();
  if (valor === 'abacatepay' || valor === 'mercadopago' || valor === 'fake') {
    return valor;
  }
  throw new Error(
    `PAYMENT_GATEWAY=${valor} não é um adapter conhecido — use "abacatepay", "mercadopago" ou "fake". ` +
      'Valor desconhecido NÃO cai em fake: isso subiria a aplicação sem cobrança online e sem aviso.',
  );
}

function criarPaymentGateway(): PaymentGateway {
  if (gatewayAtivo() === 'mercadopago') {
    const config = lerConfigMercadoPago();
    Logger.log(
      `PaymentGateway: Mercado Pago (Orders API, ambiente=${
        config.ambienteEhProducao ? 'producao' : 'staging'
      })`,
      'PaymentsModule',
    );
    // Obrigatoriedade já foi validada por `assertConfiguracaoSegura` no boot
    // (main.ts), ANTES do Nest subir — aqui só falharia se alguém instanciasse o
    // módulo por fora. `exigir` mantém a falha fechada nesse caso.
    return new MercadoPagoGateway({
      accessToken: exigir('MERCADOPAGO_ACCESS_TOKEN', 'mercadopago'),
      baseUrl: config.baseUrl,
      expiraEmSegundos: config.expiraEmSegundos,
      statementDescriptor: config.statementDescriptor,
      ...(config.emailPadraoDoPagador
        ? { emailPadraoDoPagador: config.emailPadraoDoPagador }
        : {}),
      timeoutMs: config.timeoutMs,
    });
  }
  if (gatewayAtivo() === 'abacatepay') {
    Logger.log('PaymentGateway: AbacatePay (real)', 'PaymentsModule');
    return new AbacatePayGateway({
      apiKey: exigir('ABACATEPAY_API_KEY'),
      // Checkout Transparente vive em /v2 (§ AbacatePayGateway) — v1 não tem
      // /transparents/* e emitiria eventos que não estão assinados nesta conta.
      baseUrl: process.env.ABACATEPAY_BASE_URL ?? 'https://api.abacatepay.com/v2',
      expiraEmSegundos: Number(process.env.ABACATEPAY_EXPIRA_SEGUNDOS ?? '') || EXPIRA_PADRAO_SEGUNDOS,
    });
  }
  Logger.log('PaymentGateway: Fake (sem webhook exposto)', 'PaymentsModule');
  return new FakeAbacatePayGateway();
}

function exigir(nome: string, gateway: AdapterDePagamento = 'abacatepay'): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} é obrigatória com PAYMENT_GATEWAY=${gateway}`);
  }
  return valor;
}

/**
 * O webhook real só é montado com o gateway real, e CADA gateway monta o seu.
 * Com o fake, NENHUMA superfície de webhook é exposta (o brief: "o fake não expõe
 * webhook nenhum").
 *
 * ⚠️ Isto é avaliado no IMPORT do módulo, não em runtime — quem testa precisa
 * setar `PAYMENT_GATEWAY` antes de importar (é o que `vi.hoisted()` faz em
 * `webhook-abacatepay.e2e.spec.ts`).
 */
const controllers = [
  ...(gatewayAtivo() === 'abacatepay' ? [WebhooksController] : []),
  // Cartão e webhook do Mercado Pago só existem com ele ativo — é o único
  // gateway que cobra cartão nesta integração.
  ...(gatewayAtivo() === 'mercadopago'
    ? [MercadoPagoWebhookController, PagamentosPublicoController]
    : []),
];

@Module({
  controllers,
  providers: [
    ProcessarWebhookUseCase,
    ProcessarWebhookMercadoPagoUseCase,
    EstornarPagamentoForaDaJanelaUseCase,
    PagarComCartaoUseCase,
    ExpirarPagamentoVencidoUseCase,
    AbacatePayWebhookGuard,
    MercadoPagoWebhookGuard,
    PagamentoStatusQueryService,
    CobrancaOnlineService,
    { provide: PAYMENT_GATEWAY, useFactory: criarPaymentGateway },
    // Modo manual (TEMPORÁRIO): lido uma vez no boot — a flag não muda em
    // runtime, e assim o ponto de decisão recebe config, não `process.env`.
    { provide: CONFIG_PAGAMENTO_MANUAL, useFactory: () => lerConfigPagamentoManual() },
    // Mercado Pago: mesma disciplina — lido uma vez, injetado como config.
    // Existe mesmo com outro gateway ativo (os valores ficam vazios), porque o
    // guard e o caso de uso são providers do módulo independentemente de estarem
    // sendo usados. É barato e evita um módulo condicional inteiro.
    { provide: CONFIG_MERCADO_PAGO, useFactory: () => lerConfigMercadoPago() },
    // Taxa por gateway, para a comissão incidir sobre o LÍQUIDO. Exportada porque
    // quem consome está em `scheduling` (a conclusão do atendimento) — é lá que os
    // dois mundos se encontram.
    { provide: CONFIG_COMISSAO_LIQUIDA, useFactory: () => lerConfigComissaoLiquida() },
    // O job de reconciliação só existe com o gateway que precisa dele: com
    // `fake` ou `abacatepay` não há estorno automático, e um cron rodando a
    // cada 10 min sem nada para fazer é ruído.
    ...(gatewayAtivo() === 'mercadopago' ? [ReconciliarPagamentosJob] : []),
  ],
  exports: [
    PAYMENT_GATEWAY,
    PagamentoStatusQueryService,
    ProcessarWebhookUseCase,
    ProcessarWebhookMercadoPagoUseCase,
    EstornarPagamentoForaDaJanelaUseCase,
    PagarComCartaoUseCase,
    ExpirarPagamentoVencidoUseCase,
    CobrancaOnlineService,
    CONFIG_PAGAMENTO_MANUAL,
    CONFIG_MERCADO_PAGO,
    CONFIG_COMISSAO_LIQUIDA,
  ],
})
export class PaymentsModule {}
