import { StatusPagamento } from '@bigods/contracts';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { DesfechoDaCobranca } from './payment-gateway';

/**
 * Tradução do vocabulário de status da Orders API do Mercado Pago para o nosso
 * `StatusPagamento`.
 *
 * ## Por que não é um simples `Record`
 *
 * O Mercado Pago tem DUAS camadas de status (`order.status` e
 * `transactions.payments[].status`), cada uma com seu `status_detail`, dando ~20
 * combinações. Três grupos não têm correspondente no nosso domínio:
 *
 * - **`refunded` e `charged_back`** — estorno e chargeback seguem MANUAIS nesta
 *   fase (decisão do dono; `followup.md` #3). Mapear `refunded` para `PAGO`
 *   manteria um pacote liberado com o dinheiro já devolvido; mapear para
 *   `FALHOU` alegaria que nunca funcionou, e a máquina de estado nem permite sair
 *   de `PAGO`. As duas opções mentem. Então devolvemos `REVISAO_MANUAL`: o mesmo
 *   tratamento que o `transparent.lost` da AbacatePay já recebe — registra e não
 *   toca em entidade nenhuma.
 * - **Combinação desconhecida** — LANÇA. Um status novo do Mercado Pago tem que
 *   quebrar um teste nosso, nunca virar `PAGO` por descuido de `default`.
 * - **`waiting_capture`** — não deveria acontecer com `capture_mode: automatic`,
 *   que é o que usamos. Mapeado para `EM_ANALISE` (dinheiro autorizado e não
 *   capturado não é dinheiro nosso) e sinalizado, porque se aparecer é
 *   configuração errada, não fluxo normal.
 *
 * ## Contrato com quem chama
 *
 * Este módulo é ESTRITO de propósito, mas o webhook NÃO pode ser. Combinação
 * desconhecida aqui lança; o caso de uso do webhook precisa capturar e responder
 * **200 com log alto e zero mutação** — um 4xx/5xx faria o Mercado Pago retentar
 * a cada 15 minutos para sempre.
 */

/**
 * O que fazer com o que o gateway informou.
 *
 * É o tipo da PORTA (`DesfechoDaCobranca`), não um tipo próprio do Mercado Pago:
 * "precisa de gente" é um desfecho que qualquer gateway pode produzir, e quem
 * consome (`consultarCobranca`) não deve conhecer provedor. O alias existe só
 * para o nome ler bem neste arquivo.
 */
export type DesfechoMercadoPago = DesfechoDaCobranca;

const mapeado = (status: StatusPagamento): DesfechoMercadoPago => ({ tipo: 'MAPEADO', status });
const revisao = (motivo: string): DesfechoMercadoPago => ({ tipo: 'REVISAO_MANUAL', motivo });

/**
 * Chave `"<status>/<status_detail>"`. As duas camadas (order e transaction)
 * compartilham quase todo o vocabulário, então uma tabela só serve às duas — e
 * isso é bom: se as duas divergirem no futuro, o desconhecido LANÇA em vez de
 * ser interpretado pela tabela errada.
 */
const TABELA: Readonly<Record<string, DesfechoMercadoPago>> = {
  // ── Criada, nada processado ───────────────────────────────────────────────
  'created/created': mapeado(StatusPagamento.AGUARDANDO),

  // ── Em processamento pelo emissor ────────────────────────────────────────
  // O cliente já fez a parte dele; quem está decidindo é o banco.
  'processing/in_process': mapeado(StatusPagamento.EM_ANALISE),
  'processing/pending_review_manual': mapeado(StatusPagamento.EM_ANALISE),

  // ── Falta ação do pagador ────────────────────────────────────────────────
  'action_required/waiting_payment': mapeado(StatusPagamento.AGUARDANDO),
  // PIX gerado, QR na tela, ninguém pagou ainda.
  'action_required/waiting_transfer': mapeado(StatusPagamento.AGUARDANDO),
  // Desafio 3DS em curso. AGUARDANDO de propósito (decisão do dono): o cliente
  // ainda tem ação a tomar e a janela de 30 min segue correndo — o desafio do
  // Mercado Pago dura até 40 min, e quem estourar cai no estorno automático.
  'action_required/pending_challenge': mapeado(StatusPagamento.AGUARDANDO),
  // Janela de retentativa automática do gateway após uma cobrança falha.
  'action_required/waiting_retry': mapeado(StatusPagamento.AGUARDANDO),
  // Autorizado e não capturado. Não usamos captura manual (`capture_mode:
  // automatic`), então isto sinaliza configuração errada — mas não é falha do
  // cliente nem dinheiro nosso, e o job de reconciliação é quem deve gritar.
  'action_required/waiting_capture': mapeado(StatusPagamento.EM_ANALISE),

  // ── Pago ─────────────────────────────────────────────────────────────────
  'processed/accredited': mapeado(StatusPagamento.PAGO),
  // Pago e parte devolvida. Continua PAGO porque o dinheiro ENTROU e o crédito
  // foi legitimamente liberado; o `statusDetalhe` fica persistido e visível no
  // admin, que é quem decide o que fazer com a devolução parcial.
  'processed/partially_refunded': mapeado(StatusPagamento.PAGO),

  // ── Acabou sem dinheiro ──────────────────────────────────────────────────
  'canceled/canceled': mapeado(StatusPagamento.EXPIRADO),
  'canceled/expired': mapeado(StatusPagamento.EXPIRADO),
  'expired/expired': mapeado(StatusPagamento.EXPIRADO),

  // ── Falhou ───────────────────────────────────────────────────────────────
  'failed/failed': mapeado(StatusPagamento.FALHOU),
  'failed/bad_filled_card_data': mapeado(StatusPagamento.FALHOU),
  'failed/invalid_card_token': mapeado(StatusPagamento.FALHOU),
  'failed/high_risk': mapeado(StatusPagamento.FALHOU),
  'failed/rejected_by_issuer': mapeado(StatusPagamento.FALHOU),
  'failed/required_call_for_authorize': mapeado(StatusPagamento.FALHOU),
  'failed/max_attempts_exceeded': mapeado(StatusPagamento.FALHOU),
  'failed/cc_rejected_3ds_challenge': mapeado(StatusPagamento.FALHOU),

  // ── Recusa lida na camada de PAYMENT, não de ORDER ───────────────────────
  //
  // ★ Estas entradas existem porque o adapter lê
  // `transactions.payments[0].status` ANTES de `order.status`
  // (`mercadopago.gateway.ts`), e a camada de payment usa o vocabulário
  // `rejected` + `cc_rejected_*` — herdado da Payments API legada — enquanto a
  // order usa `failed` + o detalhe curto (`high_risk`, `rejected_by_issuer`).
  //
  // Sem elas, um cartão recusado cai no `throw` da combinação desconhecida e o
  // cliente recebe **503** no lugar de "cartão recusado, tente outro". Uma recusa
  // é o desfecho mais comum de um checkout de cartão — é o caminho que MENOS pode
  // quebrar. `motivo-publico-da-recusa.ts` já traduzia `cc_rejected_*`, então a
  // intenção de tolerar as duas camadas existia; faltava aqui.
  //
  // Mesma disciplina da caixa do `data.id` na assinatura: a documentação não
  // permite decidir qual camada o gateway usa em cada situação, então aceitamos as
  // duas em vez de apostar. O detalhe CRU continua persistido, e é o admin que vê.
  'rejected/rejected': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_bad_filled_card_number': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_bad_filled_date': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_bad_filled_other': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_bad_filled_security_code': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_blacklist': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_call_for_authorize': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_card_disabled': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_card_error': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_duplicated_payment': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_high_risk': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_insufficient_amount': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_invalid_installments': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_max_attempts': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_other_reason': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_3ds_challenge': mapeado(StatusPagamento.FALHOU),
  'rejected/cc_rejected_3ds_mandatory': mapeado(StatusPagamento.FALHOU),
  // Pagamento aprovado lido na camada de payment (a order diria
  // `processed/accredited`).
  'approved/accredited': mapeado(StatusPagamento.PAGO),
  'pending/pending_challenge': mapeado(StatusPagamento.AGUARDANDO),
  'pending/pending_review_manual': mapeado(StatusPagamento.EM_ANALISE),
  'in_process/pending_review_manual': mapeado(StatusPagamento.EM_ANALISE),
  'in_process/in_process': mapeado(StatusPagamento.EM_ANALISE),
  'cancelled/expired': mapeado(StatusPagamento.EXPIRADO),
  'cancelled/cancelled': mapeado(StatusPagamento.EXPIRADO),

  // ── Sem correspondente: não inventar ─────────────────────────────────────
  'refunded/refunded': revisao('pagamento estornado no gateway'),
  'charged_back/in_process': revisao('chargeback em análise'),
  'charged_back/settled': revisao('chargeback liquidado a favor do comprador'),
  'charged_back/reimbursed': revisao('chargeback revertido a favor do vendedor'),
};

/**
 * `("processed", "accredited")` → `{ tipo: 'MAPEADO', status: PAGO }`.
 *
 * Lança em combinação desconhecida. Ver o contrato acima: quem chama pelo webhook
 * precisa capturar e responder 200.
 */
export function desfechoDoMercadoPago(status: string, statusDetalhe: string): DesfechoMercadoPago {
  const chave = `${status}/${statusDetalhe}`;
  const encontrado = TABELA[chave];
  if (!encontrado) {
    throw new InvarianteVioladaError(
      `Combinação de status desconhecida do Mercado Pago: ${chave}. ` +
        'Nenhum default é aplicado de propósito — um status novo do gateway não pode virar ' +
        'PAGO nem FALHOU por descuido. Acrescente a combinação em mercadopago-status.ts ' +
        'depois de conferir a documentação.',
    );
  }
  return encontrado;
}

/** Só para o teste de exaustividade e para diagnóstico. */
export function combinacoesConhecidas(): readonly string[] {
  return Object.keys(TABELA);
}
