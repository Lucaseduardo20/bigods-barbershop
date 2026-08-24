#!/usr/bin/env node
/**
 * Manda UM SMS de verdade pelo GTI SMS e imprime a resposta CRUA.
 *
 * Serve pra confirmar o contrato da API antes de virar a chave do OTP em
 * produção — o mesmo que foi feito com o SMS Gate na época ("formato confirmado
 * por PoC do dono"). O cliente de produção (`infra/cognito-triggers/gti-sms.js`)
 * foi escrito a partir da documentação pública; isto é a verificação.
 *
 * ⚠️ GASTA CRÉDITO. Um envio, um crédito. Por isso exige --confirmo: não dá pra
 * disparar sem querer completando um comando no histórico do shell.
 *
 * Uso:
 *   GTISMS_TOKEN=xxx node scripts/testar-sms-gtisms.mjs 11988887777 --confirmo
 *
 * O que olhar na saída:
 *   - HTTP 200 com {"status":"success"} → contrato confere;
 *   - HTTP 200 com {"status":"error"}   → falha sinalizada NO CORPO (é por isso
 *     que o cliente não confia só no código HTTP);
 *   - qualquer outro formato            → o cliente precisa ser ajustado ANTES
 *     de virar a chave, e é exatamente pra isso que este script existe.
 */

const token = process.env.GTISMS_TOKEN;
const [destino, ...flags] = process.argv.slice(2);
const endpoint = process.env.GTISMS_ENDPOINT || 'https://sms.gtisms.com/api/v3/sms/send';

if (!token) {
  console.error('✗ Falta GTISMS_TOKEN no ambiente (pegue na tela API do painel do provedor).');
  process.exit(1);
}
if (!destino) {
  console.error('✗ Informe o telefone de destino. Ex.: node scripts/testar-sms-gtisms.mjs 11988887777 --confirmo');
  process.exit(1);
}
if (!flags.includes('--confirmo')) {
  console.error('✗ Isto envia um SMS REAL e gasta um crédito. Repita com --confirmo no fim.');
  process.exit(1);
}

// Mesma normalização do cliente de produção: só dígitos, com DDI, SEM o "+".
const digitos = String(destino).replace(/\D/g, '');
const recipient =
  digitos.length > 11 && digitos.startsWith('55') ? digitos : `55${digitos}`;

const message = 'Bigod\'s Barber: teste de integracao do SMS. Pode ignorar.';

console.log(`→ POST ${endpoint}`);
console.log(`   recipient: ${recipient}   (repare: sem o "+")`);
console.log(`   message:   ${message}`);

const resposta = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ recipient, message }),
});

const texto = await resposta.text();
console.log(`\n← HTTP ${resposta.status} ${resposta.statusText}`);
console.log('← corpo cru:');
console.log(texto);

try {
  const json = JSON.parse(texto);
  const ok = resposta.ok && json.status === 'success';
  console.log(`\n${ok ? '✓' : '✗'} O cliente de produção trataria isto como ${ok ? 'SUCESSO' : 'FALHA'}.`);
  if (ok && json.data?.uid) {
    console.log(`  uid ${json.data.uid} — é este id que aparece no CloudWatch e no painel do provedor.`);
  }
  if (!ok) {
    console.log('  Se o SMS CHEGOU mesmo assim, o contrato é diferente do documentado e');
    console.log('  `infra/cognito-triggers/gti-sms.js` precisa ser ajustado antes de virar a chave.');
  }
} catch {
  console.log('\n✗ A resposta não é JSON. O cliente de produção trataria como falha.');
}
