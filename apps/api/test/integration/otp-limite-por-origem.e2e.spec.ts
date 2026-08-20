import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
// Valor baixo só para este arquivo: o comportamento sob teste é o limite
// existir e cortar, não o número exato (produção usa 30/hora, ajustável).
process.env.OTP_LIMITE_POR_ORIGEM_HORA = '4';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';

/**
 * ★ Trava de spam — o teste que a remoção do gate de envio tornou obrigatório.
 *
 * Com o gate, "só quem já tinha conta recebia código" limitava o volume por
 * acidente. Sem ele, QUALQUER telefone dispara um WhatsApp real, e o limite por
 * telefone não ajuda em nada contra varredura: mil números diferentes = mil
 * baldes diferentes, todos dentro do limite. Os dois riscos concretos são usar
 * o sistema como vetor de spam e queimar o número da barbearia por volume
 * (ban da Meta).
 *
 * A trava é contar por ORIGEM, somando todos os telefones. É o que este arquivo
 * verifica — inclusive que ela NÃO vazou para o resto da API.
 */

const companyId = `co-origem-${randomUUID()}`;
const LIMITE = 4;

const sufixo = String(Date.now()).slice(-6);
/** Um telefone DIFERENTE por chamada — é o cenário de varredura. */
const foneDaVez = (i: number) => `11 9${String(i).padStart(2, '0')}${sufixo}`;

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Origem' } });
});

afterAll(async () => {
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('Rate limit por ORIGEM no envio de OTP (vetor de spam)', () => {
  it('a mesma origem não dispara OTP para N telefones DIFERENTES acima do limite', async () => {
    // Cada telefone é inédito, então o limite POR TELEFONE (5/10min) nunca é
    // atingido — se passasse, seria com 1 de 5 usado em cada balde. O que corta
    // aqui é exclusivamente o limite por origem.
    for (let i = 0; i < LIMITE; i++) {
      await http
        .post('/conta/login/iniciar')
        .send({ companyId, telefone: foneDaVez(i) })
        .expect(201);
    }

    // Telefone novo em folha, primeiro envio dele — e ainda assim recusado,
    // porque quem estourou o limite foi a ORIGEM.
    await http
      .post('/conta/login/iniciar')
      .send({ companyId, telefone: foneDaVez(LIMITE) })
      .expect(429);
  });

  it('nenhuma mensagem foi disparada além do limite — o bloqueio é ANTES do envio', async () => {
    // O desafio só é persistido depois do envio bem-sucedido
    // (`OtpIdentityProviderBase`), então contar desafios conta envios.
    const desafios = await prisma.demoDesafioLogin.count({ where: { companyId } });
    expect(desafios).toBe(LIMITE);
  });

  it('o limite por origem NÃO vazou para o resto da API', async () => {
    // Mesma origem, já bloqueada acima para envio de OTP: leitura pública
    // continua respondendo normalmente. Sem isto, `skipIf` estaria errado e a
    // API inteira teria ganhado um teto novo de 4 requisições por hora.
    await http.get(`/public/barbeiros?companyId=${companyId}`).expect(200);
    await http.get(`/public/pacotes?companyId=${companyId}`).expect(200);
  });

  it('confirmar código não é bloqueado pelo limite de ENVIO', async () => {
    // `login/confirmar` não manda mensagem nenhuma — não carrega `@EnviaOtp()`
    // e não pode ficar refém do limite de envio, senão quem já recebeu o código
    // ficaria sem conseguir entrar.
    await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone: foneDaVez(0), codigo: '000000', desafio: 'inexistente' })
      .expect(401); // 401 (código inválido), não 429
  });
});
