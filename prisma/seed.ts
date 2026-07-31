import { PrismaClient } from '@prisma/client';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import { Timezone } from '../apps/api/src/shared/domain/timezone';
import { diaCivilChave, instanteDeDataHoraLocal } from '../apps/api/src/shared/domain/calendario';

const prisma = new PrismaClient();

const TZ_EMPRESA = 'America/Sao_Paulo';
const tz = Timezone.de(TZ_EMPRESA);
const DIAS_DE_DISPONIBILIDADE = 30;
/** Senha padrão de todos os usuários seedados — só para desenvolvimento local. */
const SENHA_PADRAO = 'bigods123';

function hashSenha(senha: string): string {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${scryptSync(senha, sal, 32).toString('hex')}`;
}

/** dia civil local + `d` dias, como "YYYY-MM-DD" (aritmética de calendário, não 24h×d). */
function diaLocalMaisDias(d: number): string {
  const hoje = diaCivilChave(new Date(), tz);
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 1, dia + d));
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}-${String(alvo.getUTCDate()).padStart(2, '0')}`;
}

/** 0=domingo .. 6=sábado (Date.getUTCDay()) — mesma convenção do ExpedienteJanela. */
function diaDaSemana(dataISO: string): number {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

const SEG_A_SAB = [1, 2, 3, 4, 5, 6]; // domingo (0) fica de fora — barbearia fechada

/**
 * Item 1 da sessão 2026-07-16: expediente semanal recorrente (seg-sáb com a
 * janela dada, domingo SEM expediente) + materialização dos próximos
 * DIAS_DE_DISPONIBILIDADE dias — substitui o antigo `seedarDisponibilidade`
 * diário, que criava disponibilidade todo santo dia (inclusive domingo,
 * barbearia fechada apareceria agendável — o bug operacional desta sessão).
 * Mesma regra do `MaterializarExpedienteUseCase`, reimplementada aqui em
 * Prisma puro porque o seed é um script standalone, sem DI do Nest.
 */
async function seedarExpediente(barbeiroId: string, horaInicio: string, horaFim: string) {
  await prisma.expedienteJanela.deleteMany({ where: { barbeiroId } });
  await prisma.expedienteJanela.createMany({
    data: SEG_A_SAB.map((diaSemana) => ({ barbeiroId, diaSemana, horaInicio, horaFim })),
  });

  // Limpa qualquer disponibilidade antiga (incl. origem MANUAL de rodadas do
  // seed anteriores à existência do ExpedienteSemanal — a materialização real
  // NUNCA apaga origem MANUAL, mas o seed sempre reconstrói do zero para os
  // barbeiros que ele próprio gerencia).
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId } });

  for (let d = 0; d < DIAS_DE_DISPONIBILIDADE; d++) {
    const data = diaLocalMaisDias(d);
    const atende = SEG_A_SAB.includes(diaDaSemana(data));
    const id = `disp-${barbeiroId}-${data}`;
    if (!atende) {
      // Domingo: sem expediente → sem disponibilidade (remove se sobrou de rodada anterior).
      await prisma.disponibilidade.deleteMany({ where: { id, origem: 'EXPEDIENTE' } });
      continue;
    }
    const janela = {
      barbeiroId,
      data,
      inicio: instanteDeDataHoraLocal(data, horaInicio, tz),
      fim: instanteDeDataHoraLocal(data, horaFim, tz),
      origem: 'EXPEDIENTE' as const,
    };
    await prisma.disponibilidade.upsert({
      where: { id },
      create: { id, ...janela },
      update: janela,
    });
  }
}

async function main() {
  const companyId = 'bigods';
  await prisma.company.upsert({
    where: { id: companyId },
    create: { id: companyId, nome: "Bigod's Barber", prazoReagendamentoDias: 10, timezone: TZ_EMPRESA },
    update: { timezone: TZ_EMPRESA },
  });

  const corteId = 'svc-corte';
  const barbaId = 'svc-barba';
  await prisma.servico.upsert({
    where: { id: corteId },
    create: { id: corteId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
    update: {},
  });
  await prisma.servico.upsert({
    where: { id: barbaId },
    create: { id: barbaId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 },
    update: {},
  });

  // ---- Produtos (item 4 da sessão 2026-07-16 — venda mínima, sem estoque) ----
  const gelId = 'prod-gel';
  const pomadaId = 'prod-pomada';
  await prisma.produto.upsert({
    where: { id: gelId },
    create: { id: gelId, companyId, nome: 'Gel Fixador', precoCentavos: 1500, ativo: true },
    update: {},
  });
  await prisma.produto.upsert({
    where: { id: pomadaId },
    create: { id: pomadaId, companyId, nome: 'Pomada Modeladora', precoCentavos: 3500, ativo: true },
    update: {},
  });

  // ---- Gabriel: sócio-barbeiro, admin + atende, 9h–18h ----
  const gabrielId = 'bar-gabriel';
  await prisma.barbeiro.upsert({
    where: { id: gabrielId },
    create: {
      id: gabrielId,
      companyId,
      nome: 'Gabriel',
      slug: 'gabriel',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
      comissaoProdutosBp: 1000, // 10% — percentual único, sem matriz por produto
      login: 'gabriel',
      senhaHash: hashSenha(SENHA_PADRAO),
    },
    update: {},
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId: gabrielId, servicoId: corteId },
      { barbeiroId: gabrielId, servicoId: barbaId },
    ],
    skipDuplicates: true,
  });
  await seedarExpediente(gabrielId, '09:00', '18:00');

  // ---- Ofertas de pacote (agregado PacoteOferta — sessão-B): cada uma tem um
  // dono (barbeiroId) e composição mista (N serviços, cada um com quantidade).
  // Preço é a fonte de verdade persistida; o percentual de desconto é sempre
  // derivado na exibição (nunca armazenado).
  const ofertas: { id: string; nome: string; precoCentavos: number; itens: { servicoId: string; quantidade: number }[] }[] = [
    // 5 cortes: R$40×5 = R$200 avulso → R$170 (desconto)
    { id: 'oferta-5-cortes', nome: '5 Cortes', precoCentavos: 17000, itens: [{ servicoId: corteId, quantidade: 5 }] },
    // 4 barbas: R$30×4 = R$120 avulso → R$100
    { id: 'oferta-4-barbas', nome: '4 Barbas', precoCentavos: 10000, itens: [{ servicoId: barbaId, quantidade: 4 }] },
    // pacote MISTO: 2 cortes + 2 barbas = R$140 avulso → R$120
    {
      id: 'oferta-combo-corte-barba',
      nome: 'Combo Corte + Barba',
      precoCentavos: 12000,
      itens: [
        { servicoId: corteId, quantidade: 2 },
        { servicoId: barbaId, quantidade: 2 },
      ],
    },
  ];
  for (const o of ofertas) {
    await prisma.pacoteOferta.upsert({
      where: { id: o.id },
      create: { id: o.id, companyId, barbeiroId: gabrielId, nome: o.nome, precoCentavos: o.precoCentavos, ativo: true },
      update: { nome: o.nome, precoCentavos: o.precoCentavos },
    });
    await prisma.pacoteOfertaItem.deleteMany({ where: { ofertaId: o.id } });
    await prisma.pacoteOfertaItem.createMany({
      data: o.itens.map((i) => ({ id: randomUUID(), ofertaId: o.id, servicoId: i.servicoId, quantidade: i.quantidade })),
    });
  }

  // ---- Admins de gestão (não atendem — só acesso ao painel) ----
  // DECISAO_PENDENTE: "admin" aqui é só o papel ADMIN sem BARBEIRO, seguindo a
  // leitura de que "2 admins" e "2 barbeiros" no pedido são categorias
  // distintas (diferente de Gabriel, que acumula os dois papéis).
  const admins = [
    { id: 'bar-lkt', nome: 'LKT', slug: 'lkt', login: 'lkt' },
    { id: 'bar-rafael-grigio', nome: 'Rafael Grigio', slug: 'rafael-grigio', login: 'rafaelgrigio' },
  ];
  for (const admin of admins) {
    await prisma.barbeiro.upsert({
      where: { id: admin.id },
      create: {
        id: admin.id,
        companyId,
        nome: admin.nome,
        slug: admin.slug,
        papeis: ['ADMIN'],
        comissaoPadraoBp: 0,
        login: admin.login,
        senhaHash: hashSenha(SENHA_PADRAO),
      },
      update: {},
    });
  }

  // ---- Barbeiros fictícios (só atendem — para testar seleção de barbeiro,
  // serviços por barbeiro, comissão por exceção e janelas de horário distintas) ----
  const lucasId = 'bar-lucas-andrade';
  await prisma.barbeiro.upsert({
    where: { id: lucasId },
    create: {
      id: lucasId,
      companyId,
      nome: 'Lucas Andrade',
      slug: 'lucas-andrade',
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4000, // 40%
      login: 'lucasandrade',
      senhaHash: hashSenha(SENHA_PADRAO),
    },
    update: {},
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId: lucasId, servicoId: corteId },
      { barbeiroId: lucasId, servicoId: barbaId },
    ],
    skipDuplicates: true,
  });
  await seedarExpediente(lucasId, '12:00', '20:00'); // turno da tarde/noite, seg-sáb

  const pedroId = 'bar-pedro-martins';
  await prisma.barbeiro.upsert({
    where: { id: pedroId },
    create: {
      id: pedroId,
      companyId,
      nome: 'Pedro Martins',
      slug: 'pedro-martins',
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 3500, // 35% padrão
      login: 'pedromartins',
      senhaHash: hashSenha(SENHA_PADRAO)
    },
    update: {},
  });
  await prisma.barbeiroServico.createMany({
    data: [
      { barbeiroId: pedroId, servicoId: corteId },
      { barbeiroId: pedroId, servicoId: barbaId },
    ],
    skipDuplicates: true,
  });
  // exceção: comissão de Barba é 60% para Pedro (matriz de comissão, DOMAIN.md §3.2)
  await prisma.excecaoComissao.upsert({
    where: { barbeiroId_servicoId: { barbeiroId: pedroId, servicoId: barbaId } },
    create: { barbeiroId: pedroId, servicoId: barbaId, percentualBp: 6000 },
    update: { percentualBp: 6000 },
  });
  await seedarExpediente(pedroId, '09:00', '13:00'); // só manhãs, seg-sáb

  // Disponibilidade dos próximos DIAS_DE_DISPONIBILIDADE dias, HORÁRIO DE SÃO
  // PAULO (não UTC — o bug que motivou a correção de fuso de uma sessão
  // anterior), seg-sáb — domingo fica SEM expediente (barbearia fechada não
  // pode aparecer agendável, o bug operacional desta sessão). Ver `seedarExpediente`.

  // Pacote exemplo: cliente + venda paga (corte + barba por R$60)
  const clienteId = 'cli-exemplo';
  await prisma.cliente.upsert({
    where: { id: clienteId },
    create: { id: clienteId, companyId, nome: 'João Exemplo', telefone: '+5511999998888' },
    update: {},
  });
  // Provisiona o cliente exemplo como usuário demo → o login OTP funciona DIRETO
  // com o telefone (11) 99999-8888, sem precisar comprar um pacote antes. Em
  // produção (Cognito) esta tabela fica vazia; aqui é só pra facilitar o teste.
  await prisma.demoIdentidade.upsert({
    where: { companyId_telefone: { companyId, telefone: '+5511999998888' } },
    create: { id: randomUUID(), companyId, telefone: '+5511999998888', sub: `demo-${clienteId}` },
    update: {},
  });
  const vendaId = 'pac-exemplo';
  const existente = await prisma.vendaDePacote.findUnique({ where: { id: vendaId } });
  if (!existente) {
    // Rateio congelado (mesma regra do domínio): 60 × 40/70 = 34,29; resíduo no último
    await prisma.vendaDePacote.create({
      data: {
        id: vendaId,
        companyId,
        clienteId,
        barbeiroId: gabrielId,
        valorPagoCentavos: 6000,
        compradoEm: new Date(),
        statusPagamento: 'PAGO',
        itens: {
          create: [
            { id: randomUUID(), servicoId: corteId, valorRateadoCentavos: 3429, status: 'DISPONIVEL' },
            { id: randomUUID(), servicoId: barbaId, valorRateadoCentavos: 2571, status: 'DISPONIVEL' },
          ],
        },
      },
    });
    await prisma.cliente.update({
      where: { id: clienteId },
      data: { cognitoSub: `local-${clienteId}` },
    });
  }

  console.log(`Seed concluído (fuso: ${TZ_EMPRESA}). Senha de todos os logins: ${SENHA_PADRAO}`);
  console.log('Admins:      gabriel (também barbeiro), lkt, rafaelgrigio');
  console.log('Barbeiros:   Gabriel (seg-sáb 09h–18h), Lucas Andrade (seg-sáb 12h–20h), Pedro Martins (seg-sáb 09h–13h, barba 60%)');
  console.log('Expediente:  domingo SEM expediente para todos (barbearia fechada) — materializado via ExpedienteSemanal');
  console.log('Produtos:    Gel Fixador (R$15) e Pomada Modeladora (R$35) — Gabriel com comissão de produto 10%');
  console.log('Conta demo:  login OTP direto com o telefone (11) 99999-8888 (João Exemplo, com pacote e créditos)');
}

main().finally(() => prisma.$disconnect());
