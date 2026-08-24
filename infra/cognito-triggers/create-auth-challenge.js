'use strict';

/**
 * Cognito trigger: Create Auth Challenge.
 *
 * Gera o código OTP de 6 dígitos, ENVIA por SMS através do SMS Gate (celular
 * Android da barbearia) e guarda o código esperado em
 * `privateChallengeParameters` — que só o Cognito e o Verify enxergam, nunca o
 * cliente. O código é propagado entre tentativas via `challengeMetadata` para
 * um erro de digitação não gerar (e não custar) um SMS novo.
 *
 * ★ FONTE DE VERDADE DO CÓDIGO: é AQUI. Com `IDENTITY_PROVIDER=cognito`, a
 * nossa base (`DemoDesafioLogin`) não guarda desafio nenhum — quem gera,
 * guarda e confere é o Cognito, via estes triggers. Isso evita dois sistemas de
 * código competindo. Ver RELATORIO_SESSAO.md.
 *
 * Deploy: runtime Node.js 20.x, handler `create-auth-challenge.handler`.
 * SEM dependências externas (usa o `fetch` global do Node 20) — o zip é este
 * arquivo + `sms-gate.js` + `gti-sms.js`.
 *
 * Env vars: `SMS_PROVIDER` ("smsgate" default, ou "gtisms") e as do provedor
 * escolhido — SMS_GATE_USER/SMS_GATE_PASSWORD, ou GTISMS_TOKEN. Ver README.md.
 */

const crypto = require('node:crypto');
const smsGate = require('./sms-gate');
const gtiSms = require('./gti-sms');

/**
 * QUAL PROVEDOR ENVIA O SMS (2026-08-21).
 *
 * Trocar é UMA variável de ambiente na Lambda — sem redeploy de código, sem
 * mexer em nada mais. Existe porque o SMS Gate depende de um celular Android
 * pareado, e essa perna final se mostrou instável: aparelho suspenso, sem
 * bateria, sem Wi-Fi, e o OTP não chega. Se o provedor novo falhar, o caminho
 * de volta é trocar a variável de novo, em segundos.
 *
 * Default `smsgate`: quem já está em produção não muda de comportamento só
 * porque este arquivo subiu.
 */
function provedorDeSms() {
  const escolhido = (process.env.SMS_PROVIDER || 'smsgate').toLowerCase();
  if (escolhido === 'gtisms') {
    return {
      nome: 'gtisms',
      enviar: (texto, telefone) =>
        gtiSms.enviarSms(
          {
            token: process.env.GTISMS_TOKEN,
            endpoint: process.env.GTISMS_ENDPOINT,
            timeoutMs: process.env.GTISMS_TIMEOUT_MS ? Number(process.env.GTISMS_TIMEOUT_MS) : undefined,
          },
          { telefone, texto },
        ),
    };
  }
  if (escolhido !== 'smsgate') {
    // Valor desconhecido não vira "usa o default em silêncio": alguém digitou
    // errado, e um OTP que não sai é caro de diagnosticar depois.
    throw new Error(`SMS_PROVIDER desconhecido: "${escolhido}". Use "gtisms" ou "smsgate".`);
  }
  return {
    nome: 'smsgate',
    enviar: (texto, telefone) =>
      smsGate.enviarSms(
        {
          usuario: process.env.SMS_GATE_USER,
          senha: process.env.SMS_GATE_PASSWORD,
          endpoint: process.env.SMS_GATE_ENDPOINT,
          timeoutMs: process.env.SMS_GATE_TIMEOUT_MS ? Number(process.env.SMS_GATE_TIMEOUT_MS) : undefined,
        },
        { telefone, texto },
      ),
  };
}

/** Minutos que o código vale — só compõe o texto; quem expira de fato é o Cognito. */
const VALIDADE_MINUTOS = 10;

function textoDoSms(codigo) {
  return `Bigod's Barber: seu codigo de acesso e ${codigo}. Vale por ${VALIDADE_MINUTOS} minutos. Nao compartilhe.`;
}

exports.handler = async (event) => {
  const sessao = event.request.session || [];

  // Reaproveita o código da tentativa anterior: errar a digitação não pode
  // disparar outro SMS (custa dinheiro e queima franquia do chip).
  const anterior = sessao.find(
    (s) => s.challengeName === 'CUSTOM_CHALLENGE' && s.challengeMetadata,
  );

  let codigo;
  if (anterior && /^CODE-\d{6}$/.test(anterior.challengeMetadata)) {
    codigo = anterior.challengeMetadata.slice(5);
  } else {
    codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const telefone = event.request.userAttributes.phone_number;
    if (!telefone) {
      // Sem telefone não há como entregar o código. Falhar aqui é melhor que
      // apresentar um desafio impossível de responder.
      throw new Error('Usuário sem phone_number — impossível enviar o OTP');
    }
    // Deixa o erro SUBIR: o Cognito recusa o InitiateAuth e a nossa API devolve
    // erro pro funil. Nunca existe desafio sem código entregue.
    const provedor = provedorDeSms();
    const aceito = await provedor.enviar(textoDoSms(codigo), telefone);
    // Rastro do envio (2026-08-20). Sem isto, "o SMS não chegou" era um beco
    // sem saída: o sucesso não deixava marca nenhuma no CloudWatch, então não
    // havia como saber pra qual número foi nem qual mensagem procurar no painel
    // do SMS Gate. `state` costuma sair como "Pending" — o cloud ACEITOU;
    // entrega é outra coisa, e é justamente essa a distinção que faltava ver.
    //
    // ⚠️ O CÓDIGO NUNCA ENTRA NO LOG. CloudWatch é lido por mais gente do que
    // se imagina, e um OTP em texto claro ali vale tanto quanto a senha.
    console.log(
      JSON.stringify({
        evento: 'sms_enviado',
        // Qual provedor mandou — na troca, é o que diz de onde veio (ou não
        // veio) cada mensagem, sem depender de lembrar quando a variável mudou.
        provedor: provedor.nome,
        destino: mascarar(telefone),
        mensagemId: aceito.id,
        // SMS Gate devolve `state`; GTI devolve `status`. Nenhum dos dois
        // significa "entregue" — significam "o provedor aceitou".
        estadoInicial: aceito.state ?? aceito.status ?? null,
      }),
    );
  }

  // O cliente NÃO recebe o código aqui — só por SMS. `publicChallengeParameters`
  // é visível pra quem chamou a API, então só vai o telefone mascarado, o
  // suficiente pra UI dizer "enviamos para •••• 1234".
  event.response.publicChallengeParameters = {
    telefone: mascarar(event.request.userAttributes.phone_number || ''),
  };
  event.response.privateChallengeParameters = { codigo };
  event.response.challengeMetadata = `CODE-${codigo}`;

  return event;
};

/** +5511998887777 → ••••7777 */
function mascarar(e164) {
  const d = String(e164).replace(/\D/g, '');
  return d.length >= 4 ? `••••${d.slice(-4)}` : '';
}
