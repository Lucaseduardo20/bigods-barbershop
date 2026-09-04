/**
 * Validação de configuração que DEVE impedir a aplicação de subir se estiver
 * insegura. Pura (recebe um mapa de env) para ser testável sem processo.
 */
import { lerConfigPagamentoManual } from './pagamento-manual';
import { lerTaxaBp } from './comissao-liquida';

export class ConfiguracaoInseguraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfiguracaoInseguraError';
  }
}

/**
 * A variável existe, mas ainda tem o valor de exemplo.
 *
 * ## Por que isto merece um gate próprio (2026-08-27)
 *
 * As checagens de presença abaixo pegam o `.env` sem a variável. Elas **não**
 * pegam o caso mais comum de todos: copiar o `.env.example`, preencher metade e
 * esquecer o resto. Foi exatamente o que aconteceu — com o Access Token ainda em
 * `APP_USR-0000…`, a API subiu saudável, o funil ofereceu cartão, o cliente
 * digitou o número, e só então o Mercado Pago devolveu **401**. O erro apareceu
 * num log de servidor, no meio de um checkout, com o cliente vendo mensagem
 * genérica. Uma condição perfeitamente visível no boot custou uma sessão de
 * depuração.
 *
 * ## A heurística, e por que 8 zeros
 *
 * Os placeholders deste projeto são corridas longas de zero (`APP_USR-0000…`, 64
 * zeros no webhook secret). Credenciais reais do Mercado Pago são hex ou base62
 * de alta entropia: num segredo de 64 hex, a chance de aparecerem 8 zeros
 * seguidos por acaso é da ordem de 1 em 10⁸. Seis zeros seria 1 em 10⁵ — ainda
 * improvável, mas o custo de um falso positivo aqui é a aplicação **não subir**,
 * e essa assimetria justifica o dígito extra.
 *
 * O falso positivo, se acontecer, é legível e tem saída óbvia: a mensagem diz
 * qual variável, e gerar a credencial de novo no painel resolve.
 */
function pareceValorDeExemplo(valor: string | undefined): boolean {
  return !!valor && /0{8,}/.test(valor);
}

/**
 * Recusa o boot quando uma credencial obrigatória ficou com o valor de exemplo.
 * Separada de `pareceValorDeExemplo` para que a mensagem cite a variável e o
 * lugar exato de onde tirar o valor certo — "configuração inválida" sem endereço
 * só move a depuração de lugar.
 */
function assertNaoEhExemplo(nome: string, valor: string | undefined, ondeAchar: string): void {
  if (pareceValorDeExemplo(valor)) {
    throw new ConfiguracaoInseguraError(
      `${nome} ainda está com o valor de exemplo do .env.example (uma sequência de zeros). ` +
        `Sem o valor real a chamada ao gateway falha com HTTP 401 no meio do checkout, ` +
        `e o cliente vê um erro genérico. Pegue o valor em: ${ondeAchar}`,
    );
  }
}

/**
 * `DEMO_MODE=true` faz a API devolver o código OTP na resposta (sem SMS) — é
 * ótimo em dev e **catastrófico** em produção (qualquer um loga como qualquer
 * telefone). Recusar subir com `DEMO_MODE=true` e `NODE_ENV=production` juntos
 * é a rede de segurança para isso nunca vazar por acidente.
 */
export function assertConfiguracaoSegura(env: NodeJS.ProcessEnv = process.env): void {
  const demoMode = env.DEMO_MODE === 'true';
  const producao = env.NODE_ENV === 'production';

  if (demoMode && producao) {
    throw new ConfiguracaoInseguraError(
      'DEMO_MODE=true não pode rodar com NODE_ENV=production — o código OTP vazaria na resposta da API. ' +
        'Use IDENTITY_PROVIDER=cognito e DEMO_MODE ausente/false em produção.',
    );
  }

  // Em produção, só um provider que envia o código de verdade é aceito —
  // lista explícita (fail closed) em vez de só recusar 'demo': qualquer
  // valor desconhecido também não sobe, nunca cai num fallback silencioso.
  // Dois canais reais, ambos válidos em produção: 'whatsapp' (Baileys, celular
  // pareado) e 'cognito' (SMS via Cognito Custom Auth + SMS Gate, ver
  // infra/cognito-triggers). Esta lista é a FONTE DA VERDADE — scripts/deploy.sh
  // só a espelha pra falhar antes de subir container.
  const PROVIDERS_VALIDOS_EM_PRODUCAO = ['cognito', 'whatsapp'];
  const identityProvider = (env.IDENTITY_PROVIDER ?? 'demo').toLowerCase();
  if (producao && !PROVIDERS_VALIDOS_EM_PRODUCAO.includes(identityProvider)) {
    throw new ConfiguracaoInseguraError(
      `IDENTITY_PROVIDER=${identityProvider} não é válido em produção (não envia OTP real). Configure IDENTITY_PROVIDER=cognito (SMS) ou whatsapp.`,
    );
  }

  // Com o gateway real ativo, o webhook fica exposto e sua validação de
  // assinatura é INCONDICIONAL — logo, a API key e o webhook secret têm de
  // existir em QUALQUER ambiente (dev com túnel, homologação, produção).
  // Sem o secret, o webhook não teria como validar a origem — falha fechada.
  const gatewayPadrao = producao ? 'abacatepay' : 'fake';
  const gateway = (env.PAYMENT_GATEWAY ?? gatewayPadrao).toLowerCase();
  if (gateway === 'abacatepay') {
    if (!env.ABACATEPAY_API_KEY) {
      throw new ConfiguracaoInseguraError(
        'PAYMENT_GATEWAY=abacatepay exige ABACATEPAY_API_KEY. Use PAYMENT_GATEWAY=fake para demo sem gateway real.',
      );
    }
    if (!env.ABACATEPAY_WEBHOOK_SECRET) {
      throw new ConfiguracaoInseguraError(
        'PAYMENT_GATEWAY=abacatepay expõe o webhook e exige ABACATEPAY_WEBHOOK_SECRET para validar a assinatura. ' +
          'Sem ele, qualquer um forjaria confirmação de pagamento. Use PAYMENT_GATEWAY=fake se não quiser expor o webhook.',
      );
    }
    assertNaoEhExemplo(
      'ABACATEPAY_API_KEY',
      env.ABACATEPAY_API_KEY,
      'painel da AbacatePay > Integração > API Keys.',
    );
    assertNaoEhExemplo(
      'ABACATEPAY_WEBHOOK_SECRET',
      env.ABACATEPAY_WEBHOOK_SECRET,
      'painel da AbacatePay > Integração > Webhooks.',
    );
    // ★ Comissão sobre o LÍQUIDO (2026-08-27): a AbacatePay não expõe líquido em
    // lugar nenhum, então a taxa configurada é a ÚNICA fonte. Sem ela, o sistema
    // não sabe descontar a taxa e lançaria comissão sobre o bruto — num ledger
    // IMUTÁVEL, onde corrigir depois exige um lançamento de ajuste por atendimento.
    // Ver `comissao-liquida.ts` para por que a alternativa (adiar o lançamento) é
    // pior: a comissão do barbeiro desapareceria em silêncio.
    if (lerTaxaBp(env.ABACATEPAY_TAXA_BASIS_POINTS, 'ABACATEPAY_TAXA_BASIS_POINTS') === null) {
      throw new ConfiguracaoInseguraError(
        'PAYMENT_GATEWAY=abacatepay exige ABACATEPAY_TAXA_BASIS_POINTS — a comissão do barbeiro incide ' +
          'sobre o valor LÍQUIDO, e a AbacatePay não informa o líquido em resposta nenhuma. ' +
          'Informe a taxa efetiva em pontos-base (1% = 100; 2,99% = 299), lida do extrato da conta. ' +
          'Use 0 se a barbearia decidir bancar a taxa inteira — mas escreva 0, não deixe vazio: ' +
          'vazio é "ninguém decidiu", e um ledger de comissão imutável não perdoa isso.',
      );
    }
  }

  // Mercado Pago (Orders API, 2026-08-26). Mesma regra do AbacatePay — o webhook
  // fica exposto e a validação de assinatura é incondicional —, mais duas travas
  // que só existem aqui e que valem a explicação:
  if (gateway === 'mercadopago') {
    if (!env.MERCADOPAGO_ACCESS_TOKEN) {
      throw new ConfiguracaoInseguraError(
        'PAYMENT_GATEWAY=mercadopago exige MERCADOPAGO_ACCESS_TOKEN. Use PAYMENT_GATEWAY=fake para demo sem gateway real.',
      );
    }
    if (!env.MERCADOPAGO_WEBHOOK_SECRET) {
      throw new ConfiguracaoInseguraError(
        'PAYMENT_GATEWAY=mercadopago expõe o webhook e exige MERCADOPAGO_WEBHOOK_SECRET para validar a assinatura. ' +
          'Sem ele, qualquer um forjaria confirmação de pagamento. O segredo é gerado no painel do Mercado Pago ' +
          'em Suas integrações > Webhooks > Configurar notificações, e é POR APLICAÇÃO (staging e produção têm o seu).',
      );
    }

    // Preenchida com o placeholder é pior que ausente: ausente falha no boot,
    // preenchida com zeros falha no primeiro checkout real. Ver `assertNaoEhExemplo`.
    assertNaoEhExemplo(
      'MERCADOPAGO_ACCESS_TOKEN',
      env.MERCADOPAGO_ACCESS_TOKEN,
      'painel do Mercado Pago > Suas integrações > sua aplicação > Credenciais (de teste ou de produção, ' +
        'conforme MERCADOPAGO_ENV). O segmento numérico logo após "APP_USR-" é o application id — se ele ' +
        'não bater com MERCADOPAGO_APPLICATION_ID, o token é de outra aplicação.',
    );
    assertNaoEhExemplo(
      'MERCADOPAGO_WEBHOOK_SECRET',
      env.MERCADOPAGO_WEBHOOK_SECRET,
      'painel do Mercado Pago > Suas integrações > sua aplicação > Webhooks > Configurar notificações. ' +
        'O segredo aparece ao SALVAR a configuração, e é por aplicação.',
    );

    // ★ Ambiente EXPLÍCITO, nunca inferido do token.
    // No Mercado Pago o Access Token de TESTE e o de PRODUÇÃO começam ambos com
    // `APP_USR-` (a conta de teste de vendedor é criada junto com a aplicação e
    // suas credenciais VIRAM as credenciais de teste). Também não existe host de
    // sandbox: os dois ambientes falam com api.mercadopago.com. Ou seja, não há
    // NADA no token nem na URL que diga em qual ambiente estamos — só esta env.
    // Sem ela, a checagem de `live_mode` do webhook não teria contra o que comparar.
    const AMBIENTES_VALIDOS = ['producao', 'staging'];
    const ambiente = (env.MERCADOPAGO_ENV ?? '').toLowerCase();
    if (!AMBIENTES_VALIDOS.includes(ambiente)) {
      throw new ConfiguracaoInseguraError(
        `MERCADOPAGO_ENV=${env.MERCADOPAGO_ENV ?? '(ausente)'} é inválido — use "producao" ou "staging". ` +
          'Teste e produção usam ambos tokens APP_USR- e o mesmo host, então o ambiente NÃO pode ser inferido: ' +
          'é esta variável que permite recusar uma notificação com live_mode divergente.',
      );
    }

    // A falha mais cara e mais provável de todas: colar o Access Token na
    // variável da chave pública. A pública vai para o browser — o token no
    // bundle é permanente e fica em cache de CDN. Um `===` fecha isso.
    if (env.MERCADOPAGO_PUBLIC_KEY && env.MERCADOPAGO_PUBLIC_KEY === env.MERCADOPAGO_ACCESS_TOKEN) {
      throw new ConfiguracaoInseguraError(
        'MERCADOPAGO_PUBLIC_KEY é idêntica a MERCADOPAGO_ACCESS_TOKEN. A chave pública é servida ao browser: ' +
          'isso publicaria o Access Token no bundle do frontend, de forma permanente e cacheada em CDN.',
      );
    }

    // Comissão sobre o líquido: aqui a taxa configurada é REDE, não fonte única —
    // o Mercado Pago informa `paid_amount` em cada order. Por isso ela é
    // OBRIGATÓRIA só em produção: em dev/staging um `paid_amount` ausente é um
    // problema de configuração que o log denuncia, não dinheiro real de barbeiro.
    if (
      producao &&
      lerTaxaBp(env.MERCADOPAGO_TAXA_BASIS_POINTS, 'MERCADOPAGO_TAXA_BASIS_POINTS') === null
    ) {
      throw new ConfiguracaoInseguraError(
        'Em produção, PAYMENT_GATEWAY=mercadopago exige MERCADOPAGO_TAXA_BASIS_POINTS como rede para o ' +
          'cálculo da comissão sobre o líquido. Normalmente o líquido vem da própria order (paid_amount); ' +
          'esta taxa cobre a resposta em que ele faltar, para não lançar comissão sobre o bruto num ledger ' +
          'imutável. Pontos-base (1% = 100). Use 0 se a barbearia decidir bancar a taxa nesses casos.',
      );
    }
  }

  // Modo manual (TEMPORÁRIO, 2026-08-18): sem o número da barbearia, o funil
  // mandaria o cliente para um link de WhatsApp quebrado bem no momento de
  // pagar — falha fechada no boot em vez de silenciosamente no checkout.
  const manual = lerConfigPagamentoManual(env);
  if (manual.ativo) {
    // Modo manual e Mercado Pago são MUTUAMENTE EXCLUSIVOS (decisão do dono,
    // 2026-08-26). O modo manual existe porque a AbacatePay demorou a liberar
    // produção: ele desliga a cobrança online e manda o cliente ao WhatsApp.
    // Ligar o Mercado Pago com ele ativo significaria configurar um gateway que
    // nunca seria chamado — e o dono descobriria isso só quando o primeiro
    // cliente não recebesse cobrança. Falha fechada, no boot, é mais barato.
    if (gateway === 'mercadopago') {
      throw new ConfiguracaoInseguraError(
        'PAGAMENTO_MANUAL_WHATSAPP=true não pode rodar com PAYMENT_GATEWAY=mercadopago — uma ou outra. ' +
          'O modo manual desliga a cobrança online, então o gateway ficaria configurado e nunca seria chamado. ' +
          'Desligue PAGAMENTO_MANUAL_WHATSAPP para cobrar pelo Mercado Pago.',
      );
    }
    // 12 dígitos é o piso de um número brasileiro com DDI (55 + DDD + 8) —
    // pega o erro clássico de esquecer o 55.
    if (manual.whatsappNumero.length < 12) {
      throw new ConfiguracaoInseguraError(
        'PAGAMENTO_MANUAL_WHATSAPP=true exige PAGAMENTO_MANUAL_WHATSAPP_NUMERO em E.164 ' +
          '(ex.: 5511990036469) — é o destino da comanda de pagamento.',
      );
    }
  }
}
