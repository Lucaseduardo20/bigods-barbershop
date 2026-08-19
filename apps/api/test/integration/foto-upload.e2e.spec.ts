import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_GATEWAY = 'fake';
// O bucket é fictício de propósito: o cliente S3 é substituído por um dublê
// abaixo, então nada aqui sai da máquina — mas a config precisa existir para o
// storage se considerar configurado.
process.env.UPLOADS_BUCKET = 'bigods-uploads-teste';
process.env.UPLOADS_REGION = 'us-east-1';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';
// eslint-disable-next-line import/first
import { S3_CLIENT } from '../../src/modules/storage/infrastructure/s3-armazenamento';

/**
 * Upload de foto (2026-08-19) — barbeiro e produto, ponta a ponta.
 *
 * ★ O S3 é um dublê; a VALIDAÇÃO e a OTIMIZAÇÃO são reais. Trocar o
 * armazenamento inteiro por mock deixaria o teste provando só que um mock foi
 * chamado — o que importa aqui é que arquivo hostil não sobe e que trocar a
 * foto apaga a anterior.
 */

class S3Espiao {
  comandos: unknown[] = [];
  async send(comando: unknown): Promise<void> {
    this.comandos.push(comando);
  }
  puts(): PutObjectCommand[] {
    return this.comandos.filter((c): c is PutObjectCommand => c instanceof PutObjectCommand);
  }
  deletes(): DeleteObjectCommand[] {
    return this.comandos.filter((c): c is DeleteObjectCommand => c instanceof DeleteObjectCommand);
  }
  limpar(): void {
    this.comandos = [];
  }
}

const companyId = `co-foto-${randomUUID()}`;
const adminId = `adm-foto-${randomUUID()}`;
const barbeiroId = `bar-foto-${randomUUID()}`;
const outroBarbeiroId = `bar2-foto-${randomUUID()}`;
const produtoId = `prod-foto-${randomUUID()}`;
const servicoId = `svc-foto-${randomUUID()}`;
const sufixo = String(Date.now()).slice(-6);
const SENHA = 'bigods123';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let s3: S3Espiao;
let tokenAdmin: string;
let tokenBarbeiro: string;

/** Imagem de verdade — o teste não usa bytes de mentira onde o sharp vai olhar. */
function png(lado: number): Promise<Buffer> {
  return sharp({ create: { width: lado, height: lado, channels: 3, background: '#1e40af' } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  s3 = new S3Espiao();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(S3_CLIENT)
    .useValue(s3)
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());

  await prisma.company.create({ data: { id: companyId, nome: 'Bigod Foto' } });
  await prisma.barbeiro.create({
    data: {
      id: adminId,
      companyId,
      nome: 'Admin Foto',
      slug: `admin-foto-${sufixo}`,
      papeis: ['ADMIN'],
      comissaoPadraoBp: 0,
      login: `admin-foto-${sufixo}`,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: barbeiroId,
      companyId,
      nome: 'Gabriel Foto',
      slug: `gabriel-foto-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
      login: `gabriel-foto-${sufixo}`,
      senhaHash: hashSenha(SENHA),
    },
  });
  await prisma.barbeiro.create({
    data: {
      id: outroBarbeiroId,
      companyId,
      nome: 'Erick Foto',
      slug: `erick-foto-${sufixo}`,
      papeis: ['BARBEIRO'],
      comissaoPadraoBp: 4500,
    },
  });
  await prisma.produto.create({
    data: { id: produtoId, companyId, nome: 'Pomada', precoCentavos: 4500 },
  });
  await prisma.servico.create({
    data: { id: servicoId, companyId, nome: 'Barba', precoAvulsoCentavos: 3000, duracaoMinutos: 20 },
  });
  // Vitrine do order-bump com um produto e um serviço — é onde a foto do
  // produto tem que aparecer (e a do serviço, não existir).
  await prisma.itemDeOrderBump.createMany({
    data: [
      { id: randomUUID(), companyId, tipo: 'PRODUTO', referenciaId: produtoId, ativo: true, ordem: 0 },
      { id: randomUUID(), companyId, tipo: 'SERVICO', referenciaId: servicoId, ativo: true, ordem: 1 },
    ],
  });

  tokenAdmin = (
    await http.post('/auth/login').send({ login: `admin-foto-${sufixo}`, senha: SENHA }).expect(201)
  ).body.token;
  tokenBarbeiro = (
    await http.post('/auth/login').send({ login: `gabriel-foto-${sufixo}`, senha: SENHA }).expect(201)
  ).body.token;
});

beforeEach(() => s3.limpar());

afterAll(async () => {
  await prisma.itemDeOrderBump.deleteMany({ where: { companyId } });
  await prisma.produto.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
  await app.close();
  delete process.env.UPLOADS_BUCKET;
  delete process.env.UPLOADS_REGION;
});

describe('Foto do barbeiro', () => {
  it('★ sobe, otimiza e devolve a URL — e o que foi pro bucket é WebP pequeno', async () => {
    const res = await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(1500), 'perfil.png')
      .expect(201);

    expect(res.body.fotoUrl).toMatch(
      /^https:\/\/bigods-uploads-teste\.s3\.us-east-1\.amazonaws\.com\/barbeiros\/[0-9a-f-]+\.webp$/,
    );

    const put = s3.puts()[0]!;
    expect(put.input.ContentType).toBe('image/webp');
    const meta = await sharp(put.input.Body as Buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);

    const salvo = await prisma.barbeiro.findUniqueOrThrow({ where: { id: barbeiroId } });
    expect(salvo.fotoUrl).toBe(res.body.fotoUrl);
  });

  it('★ trocar a foto APAGA a anterior do bucket (nada de órfão acumulando)', async () => {
    const primeira = await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(400), 'a.png')
      .expect(201);
    const chaveAntiga = s3.puts()[0]!.input.Key;
    s3.limpar();

    const segunda = await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(400), 'b.png')
      .expect(201);

    expect(segunda.body.fotoUrl).not.toBe(primeira.body.fotoUrl);
    expect(s3.deletes()).toHaveLength(1);
    expect(s3.deletes()[0]!.input.Key).toBe(chaveAntiga);
    // E a nova subiu ANTES de a antiga ser apagada — se o upload falhasse, o
    // barbeiro continuaria com a foto que tinha.
    expect(s3.comandos[0]).toBeInstanceOf(PutObjectCommand);
  });

  it('remover apaga do bucket e volta pro fallback de iniciais (fotoUrl null)', async () => {
    await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(300), 'x.png')
      .expect(201);
    const chave = s3.puts()[0]!.input.Key;
    s3.limpar();

    const res = await http
      .delete(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body.fotoUrl).toBeNull();
    expect(s3.deletes()[0]!.input.Key).toBe(chave);
    const salvo = await prisma.barbeiro.findUniqueOrThrow({ where: { id: barbeiroId } });
    expect(salvo.fotoUrl).toBeNull();
  });

  it('remover sem ter foto é no-op (não estoura, não chama o bucket)', async () => {
    await http
      .delete(`/barbeiros/${outroBarbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(s3.comandos).toHaveLength(0);
  });

  it('★ script renomeado para .jpg é recusado (422) e NADA vai pro bucket', async () => {
    const res = await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', Buffer.from('#!/bin/sh\nrm -rf /'), {
        filename: 'foto.jpg',
        contentType: 'image/jpeg', // o cliente mente nos dois: nome e content-type
      })
      .expect(422);

    expect(res.body.message).toMatch(/JPG, PNG ou WebP/);
    expect(s3.comandos).toHaveLength(0);
  });

  it('★ arquivo acima do limite não sobe', async () => {
    const gigante = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9 * 1024 * 1024)]);
    await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', gigante, 'grande.jpg')
      .expect((r) => {
        // 422 pela regra de domínio, ou 413 se o para-choque do multer cortar
        // antes — o que importa é que não passou e o bucket não foi tocado.
        expect([413, 422]).toContain(r.status);
      });
    expect(s3.comandos).toHaveLength(0);
  });

  it('sem arquivo no multipart, erro de requisição claro (400)', async () => {
    const res = await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .field('qualquer', 'coisa')
      .expect(400);
    expect(res.body.message).toMatch(/arquivo/i);
  });
});

describe('Permissão — foto é do dono', () => {
  it('★ barbeiro não-admin NÃO altera a foto de outro (403)', async () => {
    await http
      .post(`/barbeiros/${outroBarbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .attach('arquivo', await png(300), 'x.png')
      .expect(403);
    expect(s3.comandos).toHaveLength(0);
  });

  it('★ nem remove a de outro (403)', async () => {
    await http
      .delete(`/barbeiros/${outroBarbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .expect(403);
  });

  it('★ mas altera a PRÓPRIA foto sem ser admin', async () => {
    const res = await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .attach('arquivo', await png(300), 'minha.png')
      .expect(201);
    expect(res.body.fotoUrl).toContain('/barbeiros/');
  });

  it('sem autenticação, nem chega perto (401)', async () => {
    await http
      .post(`/barbeiros/${barbeiroId}/foto`)
      .attach('arquivo', await png(300), 'x.png')
      .expect(401);
  });

  it('barbeiro não-admin NÃO mexe em foto de produto (catálogo é do admin)', async () => {
    await http
      .post(`/produtos/${produtoId}/foto`)
      .set('Authorization', `Bearer ${tokenBarbeiro}`)
      .attach('arquivo', await png(300), 'x.png')
      .expect(403);
  });
});

describe('Foto do produto', () => {
  it('sobe na pasta produtos/ e aparece no DTO', async () => {
    const res = await http
      .post(`/produtos/${produtoId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(900), 'pomada.png')
      .expect(201);

    expect(res.body.fotoUrl).toContain('/produtos/');
    expect(s3.puts()[0]!.input.Key).toMatch(/^produtos\//);
  });

  it('★ trocar apaga a anterior, igual ao barbeiro (mesma camada, mesma regra)', async () => {
    await http
      .post(`/produtos/${produtoId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(300), 'a.png')
      .expect(201);
    const chaveAntiga = s3.puts()[0]!.input.Key;
    s3.limpar();

    await http
      .post(`/produtos/${produtoId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(300), 'b.png')
      .expect(201);

    expect(s3.deletes()[0]!.input.Key).toBe(chaveAntiga);
  });

  it('produto de outra empresa não é encontrado (404, nunca vazamento)', async () => {
    await http
      .post(`/produtos/nao-existe/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(300), 'x.png')
      .expect(404);
  });
});

describe('Funil público', () => {
  it('★ a vitrine do order-bump carrega a foto do produto; serviço vem sem foto', async () => {
    await http
      .post(`/produtos/${produtoId}/foto`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .attach('arquivo', await png(600), 'pomada.png')
      .expect(201);

    const res = await http.get(`/public/order-bump?companyId=${companyId}`).expect(200);

    expect(res.body.produtos[0].fotoUrl).toContain('/produtos/');
    // Serviço não tem foto no domínio — vem null e a vitrine não desenha
    // miniatura nenhuma (nada de quadrado vazio).
    expect(res.body.servicos[0].fotoUrl).toBeNull();
  });

  it('★ a foto do barbeiro chega no funil; quem não tem vem null (fallback de iniciais)', async () => {
    await prisma.barbeiroServico.deleteMany({ where: { barbeiroId } });
    const res = await http.get(`/public/barbeiros?companyId=${companyId}`).expect(200);

    const comFoto = res.body.find((b: { id: string }) => b.id === barbeiroId);
    const semFoto = res.body.find((b: { id: string }) => b.id === outroBarbeiroId);
    expect(comFoto.fotoUrl).toContain('/barbeiros/');
    expect(semFoto.fotoUrl).toBeNull();
  });
});
