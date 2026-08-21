import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';

/**
 * Prova de fiação ponta a ponta: `IDENTITY_PROVIDER=whatsapp` sobe o
 * `AppModule` de verdade (factory → `WhatsAppIdentityProvider` →
 * `HttpWhatsAppOtpClient`) sem tocar AWS em nenhum ponto, e o login OTP
 * completo funciona contra um servidor HTTP local fazendo o papel do
 * serviço whatsapp-otp (mockado — nenhum teste toca WhatsApp real). Cobre também
 * a resiliência pedida: serviço fora do ar → erro limpo, API nunca cai.
 *
 * `PAYMENT_GATEWAY=fake` fica setado aqui também para deixar registrado que
 * a mesma app sobe com o online desligado — sem isso o `WebhooksController`
 * nem monta (DECISOES_PENDENTES #11), o que já é a prova de "presencial-only".
 *
 * O boot-guard de produção (`assertConfiguracaoSegura`) é testado à parte,
 * puro, em `config-seguranca.spec.ts` — ele só roda em `main.ts`, nunca
 * dentro de `Test.createTestingModule`, então não há necessidade (nem
 * como) de exercitá-lo aqui.
 */

let mockServerFalharPara: Set<string>;
let mockServerMensagens: { telefone: string; mensagem: string; token: string | undefined }[];
let mockServer: Server;
let mockPort: number;

const INTERNAL_TOKEN = 'test-internal-token-whatsapp-otp';
const companyId = `co-whatsapp-boot-${randomUUID()}`;
const sufixo = String(Date.now()).slice(-6);
const fone = (prefixo: string) => `11 9${prefixo}${sufixo}`;

let app: INestApplication;
let http: ReturnType<typeof request>;
let e164: (telefone: string) => string;
let prisma: import('../../src/shared/infrastructure/prisma.service').PrismaService;

beforeAll(async () => {
  mockServerFalharPara = new Set();
  mockServerMensagens = [];
  mockServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (mockServerFalharPara.has(body.telefone)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'falha simulada' }));
        return;
      }
      mockServerMensagens.push({ telefone: body.telefone, mensagem: body.mensagem, token: req.headers['x-internal-token'] as string | undefined });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  mockPort = (mockServer.address() as { port: number }).port;

  process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
  process.env.IDENTITY_PROVIDER = 'whatsapp';
  process.env.WHATSAPP_OTP_SERVICE_URL = `http://127.0.0.1:${mockPort}`;
  process.env.WHATSAPP_OTP_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.WHATSAPP_OTP_TIMEOUT_MS = '2000';
  process.env.WHATSAPP_OTP_TTL_MINUTOS = '5';
  process.env.PAYMENT_GATEWAY = 'fake';

  const { AppModule } = await import('../../src/app.module');
  const { Telefone } = await import('../../src/shared/domain/telefone');
  const { PrismaService } = await import('../../src/shared/infrastructure/prisma.service');
  e164 = (telefone: string) => Telefone.de(telefone).e164;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  http = request(app.getHttpServer());

  prisma = app.get(PrismaService);
  await prisma.company.create({ data: { id: companyId, nome: 'Bigod WhatsApp Boot', timezone: 'America/Sao_Paulo' } });
});

afterAll(async () => {
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  // O log do clube tem FK pra Company — sai antes dela.
  await prisma.eventoDoClube.deleteMany({ where: { companyId: companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

function ultimaMensagemPara(telefoneE164: string) {
  const msgs = mockServerMensagens.filter((m) => m.telefone === telefoneE164);
  return msgs[msgs.length - 1];
}

describe('Boot com IDENTITY_PROVIDER=whatsapp (sem AWS) + PAYMENT_GATEWAY=fake', () => {
  it('PARTE 2: com PAYMENT_GATEWAY=fake o webhook do AbacatePay NÃO é montado — presencial-only de verdade', async () => {
    await http.post('/webhooks/abacatepay').send({}).expect(404);
  });

  it('sobe o app normalmente e completa o login OTP ponta a ponta contra o serviço whatsapp-otp mockado', async () => {
    const telefone = fone('71');
    const iniciar = await http.post('/conta/login/iniciar').send({ companyId, telefone }).expect(201);
    expect(iniciar.body.codigoDemo).toBeNull(); // WhatsApp real nunca vaza o código na resposta
    expect(iniciar.body.desafio).toBeTruthy();

    // "Recebe" a mensagem como o cliente receberia no WhatsApp de verdade.
    const enviado = ultimaMensagemPara(e164(telefone));
    expect(enviado).toBeTruthy();
    expect(enviado!.token).toBe(INTERNAL_TOKEN); // prova que o token interno foi enviado certo
    const codigo = enviado!.mensagem.match(/\d{6}/)?.[0];
    expect(codigo).toBeTruthy();

    const confirmar = await http
      .post('/conta/login/confirmar')
      .send({ companyId, telefone, codigo, desafio: iniciar.body.desafio })
      .expect(201);
    expect(confirmar.body.token).toBeTruthy();
  });

  it('serviço whatsapp-otp fora do ar: iniciar responde erro limpo (não 500 cru), e a API segue de pé pra próxima requisição', async () => {
    const telefone = fone('72');
    mockServerFalharPara.add(e164(telefone));

    const res = await http.post('/conta/login/iniciar').send({ companyId, telefone });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.status).toBeLessThan(600);
    expect(res.body.message).toBeTruthy();
    expect(res.body.message).not.toMatch(/ECONNREFUSED|AbortError|fetch failed/i); // nunca a exceção crua

    // a API não caiu — outra requisição comum, em outro telefone, funciona normalmente.
    const outroTelefone = fone('73');
    await http.post('/conta/login/iniciar').send({ companyId, telefone: outroTelefone }).expect(201);
  });
});
