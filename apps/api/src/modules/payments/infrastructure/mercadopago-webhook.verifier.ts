import { createHmac } from 'node:crypto';
import {
  extrairAssinatura,
  manifestosCandidatos,
  tsEhNumerico,
} from '../domain/mercadopago-manifesto';
import { comparaSegura } from './comparacao-segura';

/**
 * Verificação da origem de um webhook do Mercado Pago (tópico `order`).
 *
 * Pura (sem Nest, sem Prisma) para ser testável isoladamente — mesma disciplina
 * de `abacatepay-webhook.verifier.ts`.
 *
 * ## O que difere da AbacatePay, e não é pouco
 *
 * A AbacatePay assina o **corpo cru** (por isso o bootstrap usa `rawBody: true`)
 * e exige AINDA um secret na query string. O Mercado Pago faz outra coisa: o HMAC
 * é sobre um **manifesto montado a partir de query param e headers**, e o corpo
 * NÃO entra no hash. Consequência prática: o webhook do Mercado Pago **não
 * precisa de `rawBody`**.
 *
 *     HMAC_SHA256_hex(secret, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;")
 *
 * O segredo é **por aplicação**, revelado no painel em Webhooks > Configurar
 * notificações — e não é o mesmo em staging e produção.
 *
 * A montagem do manifesto (incluindo a divergência de CAIXA entre a doc e o SDK
 * oficial) mora em `domain/mercadopago-manifesto.ts`, junto com a explicação.
 * Aqui só se calcula e compara.
 *
 * ## Falha fechada
 *
 * Sem segredo configurado, sem `x-signature`, sem `ts`, sem `v1` ou com `ts`
 * não-numérico ⇒ `false`. A ÚNICA ausência tolerada é o `x-request-id`, porque a
 * documentação manda **omitir a parte do manifesto** nesse caso, não falhar.
 */
export interface EntradaVerificacaoWebhookMercadoPago {
  /** Header `x-signature` cru, formato `ts=<ms>,v1=<hex>`. */
  assinaturaHeader?: string;
  /** Header `x-request-id`, se presente. */
  requestId?: string;
  /**
   * Query param `data.id` EXATAMENTE como veio na URL.
   *
   * ★ Com Express a chave é literal, com ponto: `req.query['data.id']`. O `qs`
   * não interpreta pontos (`allowDots` é falso por padrão), então
   * `req.query.data.id` é `undefined` — e ler do CORPO daria manifesto sem o
   * `id`, resultando em 401 em 100% das notificações. Falha silenciosa.
   */
  dataId?: string;
  /** Segredo do painel (`MERCADOPAGO_WEBHOOK_SECRET`). */
  segredo: string;
  /**
   * Tolerância de atraso, em segundos. `undefined` (default) = **não confere**.
   *
   * Deixada desligada de propósito na primeira versão. Sem janela, um manifesto
   * assinado vale para sempre e o replay é eterno — mas a idempotência do
   * `ProcessarWebhookUseCase` já neutraliza o EFEITO do replay, e rejeitar por
   * `ts` velho significaria recusar webhook legítimo atrasado, com o Mercado Pago
   * retentando a cada 15 min sem sucesso. Ligar isto é trocar um risco teórico
   * por um risco operacional real, então fica atrás de configuração explícita.
   */
  toleranciaSegundos?: number;
  /** Injetado para o teste não depender do relógio real. */
  agora?: () => Date;
}

export function verificarWebhookMercadoPago(
  entrada: EntradaVerificacaoWebhookMercadoPago,
): boolean {
  if (!entrada.segredo) return false; // sem segredo configurado → falha fechada
  if (!entrada.assinaturaHeader) return false;

  const { ts, v1 } = extrairAssinatura(entrada.assinaturaHeader);
  if (!v1) return false;
  // `ts` numérico é exigido porque ele ENTRA no manifesto: um `ts` esquisito
  // produziria um hash que nunca bate, e é melhor recusar explicitamente.
  if (!tsEhNumerico(ts)) return false;

  if (entrada.toleranciaSegundos !== undefined && entrada.toleranciaSegundos > 0) {
    const agora = (entrada.agora ?? (() => new Date()))().getTime();
    // O `ts` do Mercado Pago é epoch em MILISSEGUNDOS (13 dígitos no exemplo da
    // doc). O SDK oficial multiplica por 1000 assumindo segundos, e é por isso
    // que a tolerância dele é inutilizável — ver mercadopago-manifesto.ts.
    const atrasoSegundos = Math.abs(agora - Number(ts)) / 1000;
    if (atrasoSegundos > entrada.toleranciaSegundos) return false;
  }

  // As duas variantes de caixa do `data.id` são calculadas SEM short-circuit
  // (`reduce` em vez de `some`): o que vazaria por timing seria "qual variante
  // bateu", nunca o segredo — mas manter o tempo constante documenta a intenção
  // e evita a discussão.
  const candidatos = manifestosCandidatos({
    dataId: entrada.dataId,
    requestId: entrada.requestId,
    ts: ts!,
  });

  return candidatos.reduce((bateu, manifesto) => {
    const esperado = createHmac('sha256', entrada.segredo).update(manifesto).digest('hex');
    return comparaSegura(v1, esperado) || bateu;
  }, false);
}
