import { MotivoPublicoDaRecusa } from '@bigods/contracts';

/**
 * Traduz o `status_detail` cru do gateway num motivo que pode ser MOSTRADO ao
 * cliente.
 *
 * ## Por que isto existe, e por que é tão pequeno
 *
 * `GET /public/pagamentos/:id` e a resposta do endpoint de cartão são públicos.
 * Devolver `status_detail` cru ali entregaria informação de ANTIFRAUDE ao
 * fraudador: `high_risk` diz "fomos pegos pelo modelo de risco", e
 * `max_attempts_exceeded` diz "o bloqueio é por tentativas, espere e volte".
 * Isso é calibração de graça para quem está testando cartões.
 *
 * Então o público recebe um enum pequeno e propositalmente vago. O detalhe cru
 * fica persistido em `IntencaoDePagamento.statusDetalhe` e visível SÓ no admin.
 *
 * ## O default aqui é seguro — ao contrário do de `mercadopago-status.ts`
 *
 * Lá, um `default` seria perigoso: um status novo do gateway poderia virar `PAGO`
 * por descuido, então desconhecido LANÇA. Aqui é o oposto: a mensagem ao cliente
 * nunca pode falhar, e `GENERICO` não revela nada. Um motivo novo do Mercado Pago
 * cai em `GENERICO` e o cliente vê "não foi possível concluir" — que é verdade.
 */

/**
 * Recusas em que o cliente consegue corrigir algo relendo o cartão.
 *
 * Cada conjunto abaixo carrega as DUAS grafias do mesmo motivo: a curta, que a
 * camada de `order` usa (`bad_filled_card_data`), e a `cc_rejected_*`, que a
 * camada de `transactions.payments[]` usa — ver o comentário das entradas
 * `rejected/*` em `mercadopago-status.ts` para por que ambas chegam aqui.
 */
const DADOS_DO_CARTAO = new Set([
  'bad_filled_card_data',
  'invalid_card_token',
  // O desafio 3DS falhou. Não é culpa do cartão, mas a ação útil é a mesma:
  // tentar de novo com atenção.
  'cc_rejected_3ds_challenge',
  'cc_rejected_bad_filled_card_number',
  'cc_rejected_bad_filled_date',
  'cc_rejected_bad_filled_other',
  'cc_rejected_bad_filled_security_code',
]);

/** Recusas em que quem decidiu foi o banco do cliente, e nós não temos o porquê. */
const DECISAO_DO_EMISSOR = new Set([
  'rejected_by_issuer',
  'required_call_for_authorize',
  'cc_rejected_call_for_authorize',
  'cc_rejected_card_disabled',
]);

/** Recusas por saldo/limite. */
const SEM_SALDO = new Set(['insufficient_amount', 'cc_rejected_insufficient_amount']);

export function motivoPublicoDaRecusa(statusDetalhe: string): MotivoPublicoDaRecusa {
  const chave = statusDetalhe.toLowerCase();
  if (DADOS_DO_CARTAO.has(chave)) return MotivoPublicoDaRecusa.DADOS;
  if (DECISAO_DO_EMISSOR.has(chave)) return MotivoPublicoDaRecusa.EMISSOR;
  if (SEM_SALDO.has(chave)) return MotivoPublicoDaRecusa.SALDO;
  // ★ `high_risk`, `max_attempts_exceeded`, `failed` e QUALQUER motivo novo caem
  // aqui de propósito. Dizer ao cliente "foi risco" ou "foi tentativa demais"
  // ensina o fraudador a calibrar a próxima.
  return MotivoPublicoDaRecusa.GENERICO;
}

/**
 * Motivos em que insistir não ajuda: o gateway já disse que o limite de
 * tentativas estourou, ou que o cartão está numa lista de bloqueio. Outra
 * tentativa só gera outra recusa e piora a leitura de risco da nossa conta.
 *
 * As duas grafias, pelo mesmo motivo dos conjuntos acima.
 */
const NAO_INSISTIR = new Set([
  'max_attempts_exceeded',
  'cc_rejected_max_attempts',
  'cc_rejected_blacklist',
]);

/**
 * O cliente pode tentar outro cartão?
 *
 * Sempre `true`, exceto nos motivos de `NAO_INSISTIR`. A janela de 30 min NÃO é
 * renovada em nenhum caso (decisão do dono): quem gastou 10 minutos tem 20.
 */
export function podeTentarOutroCartao(statusDetalhe: string): boolean {
  return !NAO_INSISTIR.has(statusDetalhe.toLowerCase());
}
