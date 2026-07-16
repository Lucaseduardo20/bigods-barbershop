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

/** Cria/atualiza uma janela de disponibilidade diária (horário LOCAL) para os próximos N dias. */
async function seedarDisponibilidade(barbeiroId: string, horaInicio: string, horaFim: string) {
  for (let d = 0; d < DIAS_DE_DISPONIBILIDADE; d++) {
    const data = diaLocalMaisDias(d);
    const id = `disp-${barbeiroId}-${data}`;
    const janela = {
      barbeiroId,
      data,
      inicio: instanteDeDataHoraLocal(data, horaInicio, tz),
      fim: instanteDeDataHoraLocal(data, horaFim, tz),
    };
    // update real (não `{}`) para o seed ser auto-corretivo: reaplicar depois
    // de uma mudança de regra precisa sobrescrever dados antigos, não deixá-los
    // intocados por já existir o mesmo id.
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

  // ---- Ofertas de pacote (read model do funil — não é agregado de domínio) ----
  // Preço com desconto vs. avulso. A venda expande na quantidade de serviços e o
  // rateio do domínio (§3.6) congela por cima. Ver DECISOES_PENDENTES: template +
  // desconto não são modelados no domínio; CRUD no admin fica pendente.
  const ofertas = [
    // 5 cortes: R$40×5 = R$200 avulso → R$170 (desconto)
    { id: 'oferta-5-cortes', nome: '5 Cortes', servicoId: corteId, quantidade: 5, precoCentavos: 17000 },
    // 4 barbas: R$30×4 = R$120 avulso → R$100
    { id: 'oferta-4-barbas', nome: '4 Barbas', servicoId: barbaId, quantidade: 4, precoCentavos: 10000 },
  ];
  for (const o of ofertas) {
    await prisma.pacoteOferta.upsert({
      where: { id: o.id },
      create: { ...o, companyId, ativo: true },
      update: {},
    });
  }

  // ---- Gabriel: sócio-barbeiro, admin + atende, 9h–18h ----
  const gabrielId = 'bar-gabriel';
  await prisma.barbeiro.upsert({
    where: { id: gabrielId },
    create: {
      id: gabrielId,
      companyId,
      nome: 'Gabriel',
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 4500,
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
  await seedarDisponibilidade(gabrielId, '09:00', '18:00');

  // ---- Admins de gestão (não atendem — só acesso ao painel) ----
  // DECISAO_PENDENTE: "admin" aqui é só o papel ADMIN sem BARBEIRO, seguindo a
  // leitura de que "2 admins" e "2 barbeiros" no pedido são categorias
  // distintas (diferente de Gabriel, que acumula os dois papéis).
  const admins = [
    { id: 'bar-lkt', nome: 'LKT', login: 'lkt' },
    { id: 'bar-rafael-grigio', nome: 'Rafael Grigio', login: 'rafaelgrigio' },
  ];
  for (const admin of admins) {
    await prisma.barbeiro.upsert({
      where: { id: admin.id },
      create: {
        id: admin.id,
        companyId,
        nome: admin.nome,
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
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4000, // 40%
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
  await seedarDisponibilidade(lucasId, '12:00', '20:00'); // turno da tarde/noite

  const pedroId = 'bar-pedro-martins';
  await prisma.barbeiro.upsert({
    where: { id: pedroId },
    create: {
      id: pedroId,
      companyId,
      nome: 'Pedro Martins',
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 3500, // 35% padrão
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
  await seedarDisponibilidade(pedroId, '09:00', '13:00'); // só manhãs

  // Disponibilidade dos próximos 30 dias, 9h–18h HORÁRIO DE SÃO PAULO (não UTC —
  // isso é literalmente o bug que motivou a correção de fuso desta sessão).
  // (Gabriel já seedado acima via seedarDisponibilidade.)

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
  console.log('Barbeiros:   Gabriel (09h–18h), Lucas Andrade (12h–20h), Pedro Martins (09h–13h, barba 60%)');
  console.log('Conta demo:  login OTP direto com o telefone (11) 99999-8888 (João Exemplo, com pacote e créditos)');
}

main().finally(() => prisma.$disconnect());
