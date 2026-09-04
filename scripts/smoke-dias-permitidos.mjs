#!/usr/bin/env node
/**
 * SMOKE — DIAS DA SEMANA EM QUE O CRÉDITO DE PACOTE VALE (2026-08-28).
 *
 * Roda contra uma API LOCAL de pé (`npm run dev -w @bigods/api`), com
 * `DEMO_MODE=true` e o seed de desenvolvimento aplicado. Não toca produção: se
 * a URL não for localhost, o script recusa antes de qualquer escrita.
 *
 *   node scripts/smoke-dias-permitidos.mjs
 *   API=http://localhost:3000 COMPANY=bigods ADMIN=gabriel SENHA=bigods123 node scripts/smoke-dias-permitidos.mjs
 *
 * O que ele confere, na ordem em que um cliente encostaria nisso:
 *
 *   1. o admin cria uma oferta "segunda a quinta" e ela volta na ordem de leitura;
 *   2. o funil público mostra os dias ANTES da compra;
 *   3. a compra CONGELA os dias na venda;
 *   4. a projeção esconde a sexta para esse crédito — e continua mostrando sem ele;
 *   5. a escrita recusa a sexta, dizendo quais dias valem;
 *   6. apertar a oferta DEPOIS não alcança o pacote já comprado.
 *
 * Deixa a oferta criada desativada no fim; a venda de teste fica no banco de
 * desenvolvimento (é um pacote pago de mentira, como qualquer outro do seed).
 */

const API = process.env.API ?? 'http://localhost:3000';
const COMPANY = process.env.COMPANY ?? 'bigods';
const ADMIN = process.env.ADMIN ?? 'gabriel';
const SENHA = process.env.SENHA ?? 'bigods123';
// Celular brasileiro válido: DDD + 9 + 8 dígitos. Os últimos 8 do relógio dão
// um número diferente a cada rodada, sem colidir com o do seed.
const TELEFONE = process.env.TELEFONE ?? `11 9${String(Date.now()).slice(-8)}`;

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(API)) {
  console.error(`✖ ${API} não é local. Este script escreve no banco — não aponta para produção.`);
  process.exit(2);
}

let falhas = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const falhou = (msg, detalhe) => {
  falhas++;
  console.log(`  ✖ ${msg}`);
  if (detalhe !== undefined) console.log(`      ${detalhe}`);
};
const conferir = (condicao, msg, detalhe) => (condicao ? ok(msg) : falhou(msg, detalhe));

async function chamar(caminho, { metodo = 'GET', corpo, token, esperado } = {}) {
  const res = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: {
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await res.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }
  if (esperado && res.status !== esperado) {
    throw new Error(`${metodo} ${caminho} → ${res.status} (esperado ${esperado}): ${texto.slice(0, 300)}`);
  }
  return { status: res.status, dados };
}

/** Primeiro `alvo` (0=domingo … 6=sábado) daqui a pelo menos 8 dias. */
function proximoDia(alvo) {
  const d = new Date(Date.now() + 8 * 86_400_000);
  while (d.getUTCDay() !== alvo) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const SEG = 1, TER = 2, QUA = 3, QUI = 4, SEX = 5;
const QUARTA = proximoDia(QUA);
const SEXTA = proximoDia(SEX);

const main = async () => {
  console.log(`\nSmoke: dias permitidos do pacote — ${API} (empresa ${COMPANY})`);
  console.log(`Quarta de teste: ${QUARTA} · sexta de teste: ${SEXTA}\n`);

  const { dados: login } = await chamar('/auth/login', {
    metodo: 'POST',
    corpo: { login: ADMIN, senha: SENHA },
    esperado: 201,
  });
  const admin = login.token;

  const { dados: servicos } = await chamar('/servicos', { token: admin, esperado: 200 });
  const servico = servicos.find((s) => s.ativo);
  if (!servico) throw new Error('Nenhum serviço ativo no catálogo — rode o seed de desenvolvimento.');

  const { dados: barbeiros } = await chamar('/barbeiros', { token: admin, esperado: 200 });
  const barbeiro = barbeiros.find((b) => b.ativo && b.servicosAtendidos.includes(servico.id));
  if (!barbeiro) throw new Error(`Nenhum barbeiro ativo atende ${servico.nome}.`);

  // 1. a oferta guarda os dias, na ordem de leitura
  console.log('1. o admin configura os dias na oferta');
  const { dados: oferta } = await chamar('/pacote-ofertas', {
    metodo: 'POST',
    token: admin,
    corpo: {
      nome: `Smoke Dias ${new Date().toISOString().slice(11, 19)}`,
      composicao: [{ servicoId: servico.id, quantidade: 2 }],
      precoCentavos: Math.max(100, Math.round(servico.precoAvulsoCentavos * 1.5)),
      diasPermitidos: [QUI, SEG, TER, QUA],
    },
    esperado: 201,
  });
  conferir(
    JSON.stringify(oferta.diasPermitidos) === JSON.stringify([SEG, TER, QUA, QUI]),
    'volta na ordem de leitura (segunda primeiro)',
    `recebido: ${JSON.stringify(oferta.diasPermitidos)}`,
  );
  const invalida = await chamar('/pacote-ofertas', {
    metodo: 'POST',
    token: admin,
    corpo: {
      nome: 'Smoke Dia Inválido',
      composicao: [{ servicoId: servico.id, quantidade: 1 }],
      precoCentavos: 100,
      diasPermitidos: [1, 9],
    },
  });
  conferir(invalida.status === 400, 'dia fora de 0–6 é recusado na borda', `status ${invalida.status}`);
  await chamar(`/pacote-ofertas/${oferta.id}/aprovar`, { metodo: 'PATCH', token: admin, esperado: 200 });

  // 2. o funil mostra antes da compra
  console.log('2. o funil público mostra os dias antes da compra');
  const { dados: vitrine } = await chamar(`/public/pacotes?companyId=${COMPANY}`, { esperado: 200 });
  const naVitrine = vitrine.find((o) => o.id === oferta.id);
  conferir(
    naVitrine && JSON.stringify(naVitrine.diasPermitidos) === JSON.stringify([SEG, TER, QUA, QUI]),
    'a oferta aparece no funil com os dias',
    naVitrine ? JSON.stringify(naVitrine.diasPermitidos) : 'oferta não listada',
  );

  // 3. a compra congela
  console.log('3. a compra congela os dias na venda');
  const { dados: iniciar } = await chamar('/conta/login/iniciar', {
    metodo: 'POST',
    corpo: { companyId: COMPANY, telefone: TELEFONE },
    esperado: 201,
  });
  if (!iniciar.codigoDemo) throw new Error('Sem codigoDemo — suba a API com DEMO_MODE=true.');
  const { dados: sessao } = await chamar('/conta/login/confirmar', {
    metodo: 'POST',
    corpo: { companyId: COMPANY, telefone: TELEFONE, codigo: iniciar.codigoDemo, desafio: iniciar.desafio },
    esperado: 201,
  });
  const cliente = sessao.token;

  const { dados: compra } = await chamar('/public/pacotes', {
    metodo: 'POST',
    token: cliente,
    corpo: { companyId: COMPANY, ofertaId: oferta.id, cliente: { nome: 'Cliente Smoke' } },
    esperado: 201,
  });
  await chamar(`/public/pagamentos/${compra.intencaoId}/confirmar-demo?companyId=${COMPANY}`, {
    metodo: 'POST',
    esperado: 201,
  });

  const { dados: perfil } = await chamar('/conta/perfil', { token: cliente, esperado: 200 });
  const pacote = perfil.pacotes.find((p) => p.id === compra.vendaId);
  conferir(
    pacote && JSON.stringify(pacote.diasPermitidos) === JSON.stringify([SEG, TER, QUA, QUI]),
    'a venda congelou os dias da oferta',
    pacote ? JSON.stringify(pacote.diasPermitidos) : 'pacote não veio no perfil',
  );
  const credito = pacote?.itens.find((i) => i.status === 'DISPONIVEL');
  if (!credito) throw new Error('O pacote comprado não liberou crédito — o pagamento demo não confirmou.');

  // 4. a projeção esconde
  console.log('4. a projeção esconde a sexta para este crédito');
  const url = (dia, creditoId) =>
    `/public/horarios?companyId=${COMPANY}&barbeiroId=${barbeiro.id}&data=${dia}` +
    `&servicoIds=${servico.id}${creditoId ? `&creditoId=${creditoId}` : ''}`;

  const { dados: sextaLivre } = await chamar(url(SEXTA), { esperado: 200 });
  if (sextaLivre.horarios.length === 0) {
    console.log(`  ! ${barbeiro.nome} não tem agenda em ${SEXTA} — sem isso o teste da sexta não diz nada.`);
    console.log('    Cadastre o expediente do barbeiro e rode de novo.');
  } else {
    const { dados: sextaCredito } = await chamar(url(SEXTA, credito.id), { esperado: 200 });
    conferir(
      sextaCredito.horarios.length === 0,
      'na sexta o crédito não vê horário nenhum (a agenda existe, mas some pro pacote)',
      `${sextaCredito.horarios.length} horários apareceram`,
    );
  }
  const { dados: quartaCredito } = await chamar(url(QUARTA, credito.id), { esperado: 200 });
  conferir(
    quartaCredito.horarios.length > 0,
    'na quarta o crédito vê a agenda normalmente',
    'nenhum horário — confira o expediente do barbeiro nesse dia',
  );

  const desconhecido = await chamar(url(QUARTA, '00000000-0000-4000-8000-000000000000'));
  conferir(desconhecido.status === 404, 'crédito desconhecido é 404, nunca "sem restrição"', `status ${desconhecido.status}`);

  const { dados: seletor } = await chamar(
    `/public/dias?companyId=${COMPANY}&barbeiroId=${barbeiro.id}` +
      `&de=${QUARTA}&ate=${SEXTA}&servicoIds=${servico.id}&creditoId=${credito.id}`,
    { esperado: 200 },
  );
  conferir(
    seletor.dias.find((d) => d.data === SEXTA)?.disponivel === false,
    'o seletor de dias risca a sexta',
  );

  // 5. a escrita recusa
  console.log('5. a escrita recusa a sexta, e diz quais dias valem');
  const recusa = await chamar('/atendimentos/com-credito', {
    metodo: 'POST',
    token: admin,
    corpo: {
      vendaId: compra.vendaId,
      itemIds: [credito.id],
      barbeiroId: barbeiro.id,
      data: SEXTA,
      horaInicio: '10:00',
    },
  });
  conferir(recusa.status >= 400, 'agendar na sexta é recusado', `status ${recusa.status}`);
  conferir(
    JSON.stringify(recusa.dados).includes('de segunda a quinta'),
    'a mensagem diz os dias que valem (frase derivada)',
    JSON.stringify(recusa.dados).slice(0, 200),
  );

  // 6. o snapshot resiste
  console.log('6. apertar a oferta depois não alcança quem já comprou');
  await chamar(`/pacote-ofertas/${oferta.id}`, {
    metodo: 'PATCH',
    token: admin,
    corpo: {
      nome: oferta.nome,
      composicao: [{ servicoId: servico.id, quantidade: 2 }],
      precoCentavos: oferta.precoCentavos,
      diasPermitidos: [SEG],
    },
    esperado: 200,
  });
  const { dados: perfilDepois } = await chamar('/conta/perfil', { token: cliente, esperado: 200 });
  const pacoteDepois = perfilDepois.pacotes.find((p) => p.id === compra.vendaId);
  conferir(
    JSON.stringify(pacoteDepois.diasPermitidos) === JSON.stringify([SEG, TER, QUA, QUI]),
    'o pacote já comprado manteve os dias da época da compra',
    JSON.stringify(pacoteDepois.diasPermitidos),
  );

  // limpeza: a oferta de teste não fica no funil
  await chamar(`/pacote-ofertas/${oferta.id}/status`, {
    metodo: 'PATCH',
    token: admin,
    corpo: { ativo: false },
  });

  console.log(falhas === 0 ? '\n✓ smoke verde\n' : `\n✖ ${falhas} verificação(ões) falharam\n`);
  process.exit(falhas === 0 ? 0 : 1);
};

main().catch((erro) => {
  console.error(`\n✖ ${erro.message}\n`);
  process.exit(2);
});
