import { ProvedorDePagamento } from './provedor-de-pagamento';

/**
 * As amarrações que decidem se uma notificação do Mercado Pago pode confirmar
 * UMA intenção de pagamento nossa — antes de qualquer mutação.
 *
 * ## Por que isto é necessário aqui, e não só na assinatura
 *
 * A assinatura HMAC prova que a mensagem veio de quem tem o secret. Ela NÃO prova
 * que a order descrita é nossa, nem que é DESTA intenção. O ataque concreto: numa
 * conta Mercado Pago do próprio atacante, criar uma order de R$1 com
 * `external_reference` igual ao `externalId` da vítima. Na prática a assinatura
 * dele falharia (o secret é por aplicação), mas se o secret vazar, estas
 * amarrações tornam o ataque inútil. É defesa em profundidade de verdade.
 *
 * ## O que NÃO está aqui, de propósito
 *
 * A conferência de VALOR não mora neste módulo. Ela vive em
 * `IntencaoDePagamento.confirmarPagamento(valorPago)`, onde nenhum caminho de
 * confirmação — webhook, admin, demo — consegue passar por fora. Repetir a regra
 * aqui seria a mesma regra implementada em dois lugares, que o CLAUDE.md lista
 * como anti-padrão. Este módulo responde "esta order é desta intenção?"; o
 * agregado responde "entrou o valor certo?".
 */

/** O que o `GET /v1/orders/{id}` nos contou sobre a order. */
export interface DadosDaOrder {
  /** `id` da order no Mercado Pago (`ORD01…`). */
  id: string;
  /** `external_reference` — o nosso `externalId`. Ausente é possível e tratado. */
  externalReference?: string;
}

/** O que a nossa `IntencaoDePagamento` diz de si. */
export interface DadosDaIntencao {
  externalId: string;
  /** Id da order gravado na criação. `null` em linha anterior à coluna. */
  gatewayId: string | null;
  /** Adapter que criou a cobrança. `null` em linha antiga ou modo manual. */
  gateway: ProvedorDePagamento | null;
}

/**
 * `avisos` são aceitações com ressalva — o vínculo vale, mas algo merece log.
 * Não são erro: rejeitar por eles quebraria pagamento legítimo de linha antiga.
 */
export type VeredictoDoVinculo =
  | { ok: true; avisos: readonly string[] }
  | { ok: false; motivo: string };

const recusa = (motivo: string): VeredictoDoVinculo => ({ ok: false, motivo });

/**
 * Confere se a order notificada pertence a esta intenção.
 *
 * Regra de ouro: **nunca aceitar um vínculo que casou por um só critério quando
 * os dois estavam disponíveis.** Se temos `gatewayId` gravado E a order traz
 * `external_reference`, os dois têm que bater.
 */
export function validarVinculo(
  order: DadosDaOrder,
  intencao: DadosDaIntencao,
): VeredictoDoVinculo {
  const avisos: string[] = [];

  // 1. A intenção é de OUTRO gateway. Com dois adapters reais a conviver, um
  //    webhook do Mercado Pago não pode confirmar cobrança criada pela
  //    AbacatePay — os ids vivem em espaços diferentes e a coincidência de
  //    `external_reference` seria suficiente para confundir.
  if (intencao.gateway !== null && intencao.gateway !== 'MERCADOPAGO') {
    return recusa(
      `intenção foi criada pelo gateway ${intencao.gateway}, não pelo Mercado Pago — ` +
        'uma notificação do MP não pode confirmá-la',
    );
  }
  if (intencao.gateway === null) {
    // Linha anterior à coluna `gateway`, ou criada no modo manual. Não é motivo
    // para recusar (o pagamento pode ser legítimo), mas é motivo para registrar.
    avisos.push('intenção sem `gateway` gravado (linha anterior a 2026-08-27 ou modo manual)');
  }

  // 2. `external_reference` é o nosso identificador do lado deles.
  if (order.externalReference !== undefined && order.externalReference !== '') {
    if (order.externalReference !== intencao.externalId) {
      return recusa(
        `external_reference da order (${order.externalReference}) não é o externalId da intenção ` +
          `(${intencao.externalId})`,
      );
    }
  } else if (intencao.gatewayId === null) {
    // Sem external_reference E sem gatewayId gravado não há NADA que ligue os
    // dois. Aceitar aqui seria confiar só em "o webhook chegou", que é
    // exatamente o que a assinatura não garante.
    return recusa(
      'order sem external_reference e intenção sem gatewayId gravado — não há critério de vínculo',
    );
  } else {
    avisos.push('order sem external_reference; vínculo aceito apenas pelo gatewayId');
  }

  // 3. O id da order que gravamos na criação.
  if (intencao.gatewayId !== null) {
    if (intencao.gatewayId !== order.id) {
      return recusa(
        `gatewayId da intenção (${intencao.gatewayId}) não é o id da order notificada (${order.id})`,
      );
    }
  } else {
    avisos.push('intenção sem gatewayId gravado; vínculo aceito apenas pelo external_reference');
  }

  return { ok: true, avisos };
}

/** O corpo da notificação, no que interessa para decidir se é nossa. */
export interface DadosDaNotificacao {
  applicationId?: string;
  userId?: string;
  liveMode?: boolean;
}

/** Como ESTA instância está configurada. */
export interface ContextoDaAplicacao {
  applicationId?: string;
  userId?: string;
  /** `MERCADOPAGO_ENV === 'producao'`. Explícito, nunca inferido do token. */
  ambienteEhProducao: boolean;
}

/**
 * Confere se a notificação foi emitida pela aplicação e pela conta que ESTA
 * instância conhece.
 *
 * O cenário que isto pega, e que é indetectável de outra forma: a aplicação de
 * **staging apontada para a URL de produção** (ou o inverso). Os dois ambientes
 * usam o MESMO host (`api.mercadopago.com`) e tokens com o MESMO prefixo
 * (`APP_USR-`), então nada no tráfego denuncia a troca — só o `application_id` e
 * o `live_mode` do corpo.
 *
 * Campos ausentes na notificação NÃO recusam: o Mercado Pago pode omitir, e
 * derrubar pagamento legítimo por um campo que a doc não garante seria pior que o
 * risco que se evita. Ausência gera aviso.
 */
export function validarNotificacao(
  notificacao: DadosDaNotificacao,
  contexto: ContextoDaAplicacao,
): VeredictoDoVinculo {
  const avisos: string[] = [];

  if (contexto.applicationId && notificacao.applicationId) {
    if (notificacao.applicationId !== contexto.applicationId) {
      return recusa(
        `notificação é da aplicação ${notificacao.applicationId}, e esta instância é a ` +
          `${contexto.applicationId} — provável URL de webhook cruzada entre ambientes`,
      );
    }
  } else if (!notificacao.applicationId) {
    avisos.push('notificação sem application_id');
  }

  if (contexto.userId && notificacao.userId && notificacao.userId !== contexto.userId) {
    return recusa(
      `notificação é do vendedor ${notificacao.userId}, e esta instância é a do ${contexto.userId}`,
    );
  }

  if (notificacao.liveMode !== undefined) {
    if (notificacao.liveMode !== contexto.ambienteEhProducao) {
      return recusa(
        `live_mode=${notificacao.liveMode} não corresponde ao ambiente configurado ` +
          `(MERCADOPAGO_ENV=${contexto.ambienteEhProducao ? 'producao' : 'staging'})`,
      );
    }
  } else {
    avisos.push('notificação sem live_mode');
  }

  return { ok: true, avisos };
}
