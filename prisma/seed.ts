import { PrismaClient } from '@prisma/client';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';
import { Timezone } from '../apps/api/src/shared/domain/timezone';
import { diaCivilChave, instanteDeDataHoraLocal } from '../apps/api/src/shared/domain/calendario';

const prisma = new PrismaClient();

const TZ_EMPRESA = 'America/Sao_Paulo';
const tz = Timezone.de(TZ_EMPRESA);

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
      senhaHash: hashSenha('bigods123'),
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

  // Disponibilidade dos próximos 30 dias, 9h–18h HORÁRIO DE SÃO PAULO (não UTC —
  // isso é literalmente o bug que motivou a correção de fuso desta sessão).
  for (let d = 0; d < 30; d++) {
    const data = diaLocalMaisDias(d);
    const id = `disp-${gabrielId}-${data}`;
    const janela = {
      barbeiroId: gabrielId,
      data,
      inicio: instanteDeDataHoraLocal(data, '09:00', tz),
      fim: instanteDeDataHoraLocal(data, '18:00', tz),
    };
    // update real (não `{}`) para o seed ser auto-corretivo: reaplicar depois
    // de uma mudança de regra (como esta correção de fuso) precisa sobrescrever
    // dados antigos, não deixá-los intocados por já existir o mesmo id.
    await prisma.disponibilidade.upsert({
      where: { id },
      create: { id, ...janela },
      update: janela,
    });
  }

  // Pacote exemplo: cliente + venda paga (corte + barba por R$60)
  const clienteId = 'cli-exemplo';
  await prisma.cliente.upsert({
    where: { id: clienteId },
    create: { id: clienteId, companyId, nome: 'João Exemplo', telefone: '+5511999998888' },
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

  console.log(`Seed concluído (fuso: ${TZ_EMPRESA}). Login do painel: gabriel / bigods123`);
}

main().finally(() => prisma.$disconnect());
