import { PrismaClient } from '@prisma/client';
import { randomUUID, scryptSync, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

function hashSenha(senha: string): string {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${scryptSync(senha, sal, 32).toString('hex')}`;
}

async function main() {
  const companyId = 'bigods';
  await prisma.company.upsert({
    where: { id: companyId },
    create: { id: companyId, nome: "Bigod's Barber", prazoReagendamentoDias: 10 },
    update: {},
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

  // Disponibilidade dos próximos 30 dias, 9h–18h UTC
  for (let d = 0; d < 30; d++) {
    const dia = new Date();
    dia.setUTCDate(dia.getUTCDate() + d);
    const data = dia.toISOString().slice(0, 10);
    const id = `disp-${gabrielId}-${data}`;
    await prisma.disponibilidade.upsert({
      where: { id },
      create: {
        id,
        barbeiroId: gabrielId,
        data,
        inicio: new Date(`${data}T09:00:00.000Z`),
        fim: new Date(`${data}T18:00:00.000Z`),
      },
      update: {},
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

  console.log('Seed concluído. Login do painel: gabriel / bigods123');
}

main().finally(() => prisma.$disconnect());
