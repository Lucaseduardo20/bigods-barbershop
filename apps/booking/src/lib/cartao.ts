import { MotivoPublicoDaRecusa, ResultadoDoCartao } from '@bigods/contracts';

/**
 * Lógica pura do checkout de cartão: validação local dos campos que o cliente
 * digita fora dos Secure Fields, e tradução dos desfechos do backend para texto.
 *
 * Nada aqui toca PAN, CVV ou validade — esses três vivem dentro de iframes de
 * `sdk.mercadopago.com` e nunca passam pelo nosso JavaScript. Por isso este
 * arquivo pode existir sem nenhum cuidado especial de memória ou log: ele só vê
 * nome do titular e CPF.
 */

/**
 * Palavras que o Mercado Pago usa no campo "nome do titular" para FORÇAR um
 * desfecho no ambiente de teste: `APRO` aprova, `FUND` recusa por saldo, `SECU`
 * por CVV inválido, e assim por diante.
 *
 * ★ Elas existem aqui porque a regra de duas palavras abaixo tornava o
 * procedimento de teste do próprio Mercado Pago IMPOSSÍVEL de executar pela nossa
 * tela (2026-08-27): são todas de uma palavra só, e o botão de pagar ficava
 * desabilitado. O sintoma foi um teste de cartão que não passava do formulário.
 *
 * Aceitá-las em produção é inofensivo: os nomes mágicos só têm efeito quando a
 * cobrança usa credenciais de teste. Com credenciais de produção, `APRO` é apenas
 * um nome de titular esquisito que o emissor vai recusar como qualquer outro.
 * Ou seja, isto não abre caminho para forçar aprovação com dinheiro real.
 *
 * Fonte: developers.mercadopago.com > Checkout API (Orders) > Testar > Cartões.
 */
const STATUS_DE_TESTE_DO_MERCADO_PAGO = new Set([
  'APRO', 'OTHE', 'CONT', 'CALL', 'FUND', 'SECU', 'EXPI', 'FORM',
  'CARD', 'INST', 'DUPL', 'LOCK', 'CTNA', 'ATTE', 'BLAC', 'UNSU', 'TEST',
]);

/** Nome como impresso no cartão. Só o suficiente para não gastar um round-trip. */
export function nomeDoTitularEhValido(bruto: string): boolean {
  const limpo = bruto.trim();
  if (limpo.length < 3 || limpo.length > 26) return false;
  // Palavra de status do sandbox: uma palavra só, e é o procedimento documentado.
  if (STATUS_DE_TESTE_DO_MERCADO_PAGO.has(limpo.toUpperCase())) return true;
  // Duas palavras é o mínimo que um cartão brasileiro traz; 26 é o limite de
  // impressão em relevo mais comum. Não validamos acentos nem hífen: nomes reais
  // têm os dois, e uma regra "esperta" aqui rejeitaria clientes de verdade.
  return /\s/.test(limpo);
}

/** Só dígitos, para comparar e enviar. Aceita a máscara que o cliente digitou. */
export function apenasDigitos(bruto: string): string {
  return bruto.replace(/\D/g, '');
}

/**
 * CPF com dígitos verificadores conferidos.
 *
 * ★ Validamos AQUI, no browser, porque a alternativa é o cliente descobrir o erro
 * de digitação como "pagamento recusado" — o Mercado Pago não distingue
 * "identificação inválida" de "cartão negado" na resposta pública, e o cliente
 * culparia o cartão. Um dígito trocado é o erro mais comum do formulário todo.
 *
 * Não é validação de segurança (o servidor não confia nisto): é para o cliente.
 */
export function cpfEhValido(bruto: string): boolean {
  const d = apenasDigitos(bruto);
  if (d.length !== 11) return false;
  // Todos iguais passam na conta dos dígitos (00000000000, 11111111111…) e são
  // inválidos por convenção da Receita — é a armadilha clássica desta função.
  if (/^(\d)\1{10}$/.test(d)) return false;

  const digito = (ate: number): number => {
    let soma = 0;
    let peso = ate + 1;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * peso--;
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

/** Máscara de exibição `000.000.000-00`, aplicada progressivamente. */
export function formatarCpf(bruto: string): string {
  const d = apenasDigitos(bruto).slice(0, 11);
  const partes = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9), d.slice(9, 11)].filter(
    (p) => p.length > 0,
  );
  let saida = partes[0] ?? '';
  if (partes[1]) saida += `.${partes[1]}`;
  if (partes[2]) saida += `.${partes[2]}`;
  if (partes[3]) saida += `-${partes[3]}`;
  return saida;
}

/**
 * Mensagem para uma recusa.
 *
 * ★ O backend já reduziu o `status_detail` cru do gateway a quatro motivos vagos
 * (ver `MotivoPublicoDaRecusa`). Aqui a tradução para português segue a mesma
 * disciplina: dizer o que o cliente PODE FAZER, sem confirmar hipótese do
 * fraudador. `GENERICO` é onde caem antifraude e motivos novos, e por isso não
 * pode sugerir "tente de novo" com confiança — sugere trocar de cartão.
 */
export function textoDaRecusa(motivo: MotivoPublicoDaRecusa | undefined): string {
  switch (motivo) {
    case MotivoPublicoDaRecusa.DADOS:
      return 'Confira o número, a validade e o código de segurança do cartão — algum dado não bateu.';
    case MotivoPublicoDaRecusa.SALDO:
      return 'O cartão não tem limite disponível para este valor. Tente outro cartão.';
    case MotivoPublicoDaRecusa.EMISSOR:
      return 'O banco do seu cartão não autorizou a compra. Fale com ele ou use outro cartão.';
    default:
      // Inclui `GENERICO` e o caso de o backend não mandar motivo nenhum.
      return 'Não conseguimos aprovar este cartão. Tente outro cartão ou pague por PIX.';
  }
}

/** Texto da tela para os desfechos que NÃO são recusa. */
export function textoDoResultado(resultado: ResultadoDoCartao): string {
  switch (resultado) {
    case ResultadoDoCartao.APROVADO:
      return 'Pagamento aprovado!';
    case ResultadoDoCartao.EM_ANALISE:
      return 'Seu banco está analisando a compra. Assim que ele responder, esta tela avança sozinha — não precisa pagar de novo.';
    case ResultadoDoCartao.DESAFIO_3DS:
      return 'Seu banco pediu uma confirmação extra. Conclua a verificação abaixo para finalizar o pagamento.';
    case ResultadoDoCartao.RECUSADO:
      // Quem chama usa `textoDaRecusa`, que sabe o motivo. Este ramo existe para
      // o switch ser exaustivo, não para ser exibido.
      return 'Cartão recusado.';
  }
}

/**
 * Erros de tokenização do MercadoPago.js, traduzidos.
 *
 * O SDK devolve uma lista de `{ code, description }` em inglês, e os códigos são
 * do formato `E301` (número inválido), `E302` (CVV inválido), `316`, `325`… Como
 * o PAN vive no iframe, este é o ÚNICO canal pelo qual sabemos que o cliente
 * digitou algo errado no campo do cartão — sem tradução, ele vê "invalid
 * parameter card_number" e não sabe o que corrigir.
 */
export function textoDoErroDeTokenizacao(codigos: string[]): string {
  const tem = (...alvos: string[]) => codigos.some((c) => alvos.includes(c));
  if (tem('E301', '205', '221')) return 'Número do cartão inválido — confira os dígitos.';
  if (tem('E302', '224', 'E203')) return 'Código de segurança (CVV) inválido.';
  if (tem('316')) return 'Nome do titular inválido.';
  if (tem('325', '326', '208', '209', 'E204')) return 'Validade inválida — confira mês e ano.';
  if (tem('324', '212', '214')) return 'CPF inválido.';
  return 'Confira os dados do cartão e tente de novo.';
}

/**
 * O checkout de cartão pode ser oferecido?
 *
 * Precisa dos DOIS: o backend anunciar o meio e a chave pública existir. Sem
 * chave não há tokenização, e mostrar o botão levaria o cliente a um formulário
 * que falha no submit — pior que não oferecer.
 */
export function cartaoDisponivel(pagamentoOnline: {
  meios: readonly string[];
  mercadoPagoPublicKey: string | null;
}): boolean {
  return (
    pagamentoOnline.meios.includes('CARTAO_CREDITO') && !!pagamentoOnline.mercadoPagoPublicKey
  );
}

/**
 * Bandeira deduzida LOCALMENTE do BIN, sem rede.
 *
 * ## Por que isto existe, se o SDK já resolve
 *
 * Porque o SDK falhando não pode impedir o cliente de pagar. `getPaymentMethods`
 * é uma chamada de rede a `api.mercadopago.com` — sujeita a CSP não aplicada,
 * extensão de privacidade, latência, ou simplesmente a uma resposta em formato
 * diferente do esperado. Em qualquer desses casos o checkout inteiro travava com
 * "não reconhecemos a bandeira do cartão", que é uma mensagem que culpa o cliente
 * por um problema nosso.
 *
 * O SDK continua sendo a fonte PRIMÁRIA — ele é autoritativo e conhece bandeiras
 * regionais e faixas novas. Esta tabela é a rede: cobre o que 99% dos cartões
 * brasileiros são, é determinística e não depende de nada.
 *
 * ## As faixas
 *
 * Elo e Hipercard vêm ANTES de Mastercard/Visa de propósito: os BINs de Elo caem
 * dentro das faixas de Visa (4…) e Mastercard (5…), e quem checar `4` primeiro
 * classifica um Elo como Visa. A ordem aqui é a regra.
 *
 * Os ids são os do Mercado Pago (`master`, `visa`, `elo`, `amex`, `hipercard`),
 * não nomes de exibição — é o que vai em `payment_method.id`.
 */
export function bandeiraPeloBin(bin: string): string | null {
  const d = apenasDigitos(bin);
  if (d.length < 6) return null;
  const seis = Number(d.slice(0, 6));
  const quatro = Number(d.slice(0, 4));
  const dois = Number(d.slice(0, 2));

  // ── Elo: faixas oficiais, e elas invadem o espaço de Visa e Mastercard ─────
  const ELO_SEIS = [
    401178, 401179, 431274, 438935, 451416, 457393, 457631, 457632, 504175, 627780, 636297,
    636368, 651652, 651653, 651654, 651655, 651656, 651657, 651658, 651659, 655000, 655001,
  ];
  if (ELO_SEIS.includes(seis)) return 'elo';
  if (seis >= 506699 && seis <= 506778) return 'elo';
  if (seis >= 509000 && seis <= 509999) return 'elo';
  if (seis >= 650031 && seis <= 650033) return 'elo';
  if (seis >= 650035 && seis <= 650051) return 'elo';
  if (seis >= 650405 && seis <= 650439) return 'elo';
  if (seis >= 650485 && seis <= 650538) return 'elo';
  if (seis >= 650541 && seis <= 650598) return 'elo';
  if (seis >= 650700 && seis <= 650718) return 'elo';
  if (seis >= 650720 && seis <= 650727) return 'elo';
  if (seis >= 650901 && seis <= 650978) return 'elo';
  if (seis >= 651652 && seis <= 651679) return 'elo';
  if (seis >= 655021 && seis <= 655058) return 'elo';

  // ── Hipercard ─────────────────────────────────────────────────────────────
  if (seis === 606282 || seis === 637095 || seis === 637568 || seis === 637599) return 'hipercard';

  // ── Amex ──────────────────────────────────────────────────────────────────
  if (dois === 34 || dois === 37) return 'amex';

  // ── Mastercard: 51–55 e a faixa nova 2221–2720 ────────────────────────────
  if (dois >= 51 && dois <= 55) return 'master';
  if (quatro >= 2221 && quatro <= 2720) return 'master';

  // ── Visa ──────────────────────────────────────────────────────────────────
  if (d.startsWith('4')) return 'visa';

  return null;
}
