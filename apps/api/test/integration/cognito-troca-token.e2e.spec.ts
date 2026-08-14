import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

// Provider demo: o caminho tradicional continua existindo lado a lado com o do
// Cognito — este teste também confere que os dois convivem.
process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { Telefone } from '../../src/shared/domain/telefone';
// eslint-disable-next-line import/first
import {
  COGNITO_TOKEN_VERIFIER,
  CognitoTokenVerifier,
} from '../../src/modules/identity/domain/cognito-token-verifier';

/**
 * E2E do experimento "Amplify no funil" — a troca do `idToken` do Cognito pela
 * NOSSA sessão de cliente (`POST /conta/login/cognito`).
 *
 * O verificador é mockado: o que está sob teste é a política em volta
 * (reconciliar cliente, promover a usuário, emitir sessão que os guards
 * aceitam, recusar token inválido), não a validação de assinatura da AWS —
 * essa é da `aws-jwt-verify` e está coberta em
 * `aws-jwt-cognito-token.verifier.spec.ts`. Nenhum teste toca a AWS.
 */

const companyId = `co-cognito-${randomUUID()}`;
const sufixo = String(Date.now()).slice(-6);
const foneNovo = `11 97000${sufixo}`;
const foneExistente = `11 97111${sufixo}`;
const e164 = (t: string) => Telefone.de(t).e164;

const SUB_COGNITO = `cognito-sub-${randomUUID()}`;

/** Verificador falso: aceita só o token "bom", com o telefone que o teste mandar. */
const verifierFalso: CognitoTokenVerifier = {
  async verificar(idToken: string) {
    if (idToken === 'token-bom-novo') {
      return { sub: SUB_COGNITO, telefoneE164: e164(foneNovo) };
    }
    if (idToken === 'token-bom-existente') {
      return { sub: SUB_COGNITO, telefoneE164: e164(foneExistente) };
    }
    if (idToken === 'token-telefone-quebrado') {
      return { sub: SUB_COGNITO, telefoneE164: 'nao-e-telefone' };
    }
    return null;
  },
};

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(COGNITO_TOKEN_VERIFIER)
    .useValue(verifierFalso)
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Cognito' } });
  // Cliente que já existe (veio de um agendamento avulso, por exemplo) — a
  // troca de token tem que RECONCILIAR por telefone, não criar um segundo.
  await prisma.cliente.create({
    data: {
      id: randomUUID(),
      companyId,
      nome: 'Cliente Antigo',
      telefone: e164(foneExistente),
    },
  });
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
});

describe('POST /conta/login/cognito — troca do idToken pela sessão do cliente', () => {
  it('token válido de telefone NOVO cria o cliente, promove a usuário e devolve sessão utilizável', async () => {
    const res = await http
      .post('/conta/login/cognito')
      .send({ companyId, idToken: 'token-bom-novo' })
      .expect(201);

    expect(res.body.token).toBeTruthy();
    expect(res.body.cliente.telefone).toBe(e164(foneNovo));

    const cliente = await prisma.cliente.findFirst({
      where: { companyId, telefone: e164(foneNovo) },
    });
    expect(cliente).toBeTruthy();
    // A posse do telefone foi provada (do lado da AWS) → promove a usuário,
    // exatamente como o OTP tradicional faz.
    expect(cliente!.cognitoSub).toBe(SUB_COGNITO);

    // A sessão emitida é a nossa, e vale nos guards de @ContaCliente().
    const perfil = await http
      .get('/conta/perfil')
      .set('Authorization', `Bearer ${res.body.token}`)
      .expect(200);
    expect(perfil.body.cliente.telefone).toBe(e164(foneNovo));
  });

  it('token válido de telefone JÁ EXISTENTE reconcilia — não cria cliente duplicado', async () => {
    await http
      .post('/conta/login/cognito')
      .send({ companyId, idToken: 'token-bom-existente' })
      .expect(201);

    const clientes = await prisma.cliente.findMany({
      where: { companyId, telefone: e164(foneExistente) },
    });
    expect(clientes).toHaveLength(1);
    expect(clientes[0]!.nome).toBe('Cliente Antigo'); // não sobrescreve o cadastro
    expect(clientes[0]!.cognitoSub).toBe(SUB_COGNITO);
  });

  it('token recusado pelo verificador devolve 401 e não cria nada', async () => {
    const antes = await prisma.cliente.count({ where: { companyId } });

    await http
      .post('/conta/login/cognito')
      .send({ companyId, idToken: 'token-adulterado' })
      .expect(401);

    expect(await prisma.cliente.count({ where: { companyId } })).toBe(antes);
  });

  it('token válido mas com telefone inutilizável devolve 401 (não 500)', async () => {
    await http
      .post('/conta/login/cognito')
      .send({ companyId, idToken: 'token-telefone-quebrado' })
      .expect(401);
  });

  it('corpo sem idToken é recusado na borda (400)', async () => {
    await http.post('/conta/login/cognito').send({ companyId }).expect(400);
  });
});

describe('Convivência: o login OTP tradicional continua funcionando', () => {
  it('iniciar/confirmar pelo provider demo segue emitindo sessão normalmente', async () => {
    const fone = `11 97222${sufixo}`;
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone: fone }).expect(201);
    expect(iniciar.body.codigoDemo).toMatch(/^\d{6}$/);

    const confirmar = await http
      .post('/conta/login/confirmar')
      .send({
        companyId,
        telefone: fone,
        codigo: iniciar.body.codigoDemo,
        desafio: iniciar.body.desafio,
      })
      .expect(201);
    expect(confirmar.body.token).toBeTruthy();

    await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
    await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  });
});

describe('Sem Cognito configurado (o caso de produção hoje)', () => {
  it('provisionar recusa com 503 em vez de estourar erro de configuração', async () => {
    // O provider real é criado por factory e é `null` sem COGNITO_USER_POOL_ID —
    // aqui o token de provisionamento NÃO foi sobrescrito, então continua null.
    await http
      .post('/conta/login/cognito/provisionar')
      .send({ companyId, telefone: foneNovo })
      .expect(503);
  });
});
