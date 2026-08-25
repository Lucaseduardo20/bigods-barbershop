import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
process.env.IDENTITY_PROVIDER = 'demo';
process.env.DEMO_MODE = 'true';
process.env.PAYMENT_GATEWAY = 'fake';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import {
  OpcoesSeedProducao,
  opcoesDoAmbiente,
  seedProducao,
} from '../../src/scripts/seed-producao';

/**
 * SEED DE PRODUÇÃO — o script que roda na virada, depois de apagar o banco de
 * testes do go-live.
 *
 * O que estes testes protegem, em ordem de gravidade:
 *
 *  1. ★★ o admin criado CONSEGUE ENTRAR. É o checkpoint de que tudo depende:
 *     sem um admin logável não existe caminho para criar o primeiro usuário
 *     (criar barbeiro exige admin autenticado), e o sistema fica inacessível
 *     com o banco já apagado. O teste faz o login de verdade, pelo endpoint
 *     real, com a senha que o operador passaria na env;
 *  2. ★★ rodar de novo NÃO reseta a senha — o procedimento manda trocar a senha
 *     inicial no primeiro acesso, e um seed que "conserta" a linha devolveria a
 *     senha fraca e temporária sem ninguém perceber;
 *  3. ★  nada de desenvolvimento entra junto: nem serviço, nem produto, nem
 *     Gabriel, nem pacote de exemplo;
 *  4.    a comissão de produto nasce em ZERO — o sistema nunca paga o que
 *     ninguém configurou (o procedimento tem um passo dedicado a configurá-la).
 */

const companyId = `co-seedprod-${randomUUID()}`;
const adminLogin = `lkt-seedprod-${randomUUID().slice(0, 8)}`;
const SENHA_INICIAL = 'trocar-depois-1';
const SENHA_OUTRA = 'outra-senha-9';

const opcoes: OpcoesSeedProducao = {
  companyId,
  companyNome: "Bigod's Barber (teste)",
  adminLogin,
  adminNome: 'LKT',
  senha: SENHA_INICIAL,
};

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('opções vêm do ambiente, nunca do código', () => {
  it('recusa rodar sem ADMIN_SEED_SENHA', () => {
    expect(() => opcoesDoAmbiente({})).toThrow(/ADMIN_SEED_SENHA/);
  });

  it('recusa senha curta demais para o próprio login aceitar', () => {
    // @MinLength(4) do LoginDto: com menos, o admin nasceria trancado para fora.
    expect(() => opcoesDoAmbiente({ ADMIN_SEED_SENHA: 'abc' })).toThrow(/mínimo/);
  });

  it('em produção nada é passado — os defaults SÃO os valores de produção', () => {
    const o = opcoesDoAmbiente({ ADMIN_SEED_SENHA: 'senha-de-teste' });
    expect(o.companyId).toBe('bigods');
    expect(o.adminLogin).toBe('lkt');
  });
});

describe('★ o seed cria um admin, e só isso', () => {
  it('cria a empresa e exatamente um admin', async () => {
    const r = await seedProducao(prisma, opcoes);
    expect(r.companyCriada).toBe(true);
    expect(r.adminCriado).toBe(true);

    const barbeiros = await prisma.barbeiro.findMany({ where: { companyId } });
    expect(barbeiros).toHaveLength(1);
    expect(barbeiros[0]!.login).toBe(adminLogin);
    expect(barbeiros[0]!.papeis).toEqual(['ADMIN']);
    // Não atende: comissão de serviço zero não é campo esquecido.
    expect(barbeiros[0]!.comissaoPadraoBp).toBe(0);
    expect(barbeiros[0]!.ativo).toBe(true);
  });

  it('a comissão de PRODUTO da empresa nasce em zero', async () => {
    const empresa = await prisma.company.findUnique({ where: { id: companyId } });
    expect(empresa?.comissaoProdutosBp).toBe(0);
  });

  it('não traz nada do seed de desenvolvimento', async () => {
    const [servicos, produtos, ofertas, clientes, degraus] = await Promise.all([
      prisma.servico.count({ where: { companyId } }),
      prisma.produto.count({ where: { companyId } }),
      prisma.pacoteOferta.count({ where: { companyId } }),
      prisma.cliente.count({ where: { companyId } }),
      prisma.degrauDeDesconto.count({ where: { companyId } }),
    ]);
    expect([servicos, produtos, ofertas, clientes, degraus]).toEqual([0, 0, 0, 0, 0]);

    const gabriel = await prisma.barbeiro.findFirst({ where: { companyId, nome: 'Gabriel' } });
    expect(gabriel).toBeNull();
  });
});

describe('★★ o admin criado consegue entrar — o checkpoint da virada', () => {
  it('autentica pelo fluxo de staff local, com a senha da env', async () => {
    const res = await http.post('/auth/login').send({ login: adminLogin, senha: SENHA_INICIAL });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.usuario.papeis).toEqual(['ADMIN']);
  });

  it('senha errada não entra', async () => {
    await http.post('/auth/login').send({ login: adminLogin, senha: 'nao-e-essa' }).expect(401);
  });
});

describe('★★ idempotente: rodar de novo não duplica NEM sobrescreve', () => {
  it('não cria um segundo admin', async () => {
    const r = await seedProducao(prisma, opcoes);
    expect(r.adminCriado).toBe(false);
    expect(r.companyCriada).toBe(false);
    expect(await prisma.barbeiro.count({ where: { companyId } })).toBe(1);
  });

  it('não reseta a senha — a troca do primeiro acesso sobrevive a um seed repetido', async () => {
    // Simula o dono tendo trocado a senha no painel depois do primeiro acesso.
    await http.post('/auth/login').send({ login: adminLogin, senha: SENHA_INICIAL }).expect(201);
    const { body } = await http
      .post('/auth/login')
      .send({ login: adminLogin, senha: SENHA_INICIAL })
      .expect(201);
    await http
      .put('/auth/senha')
      .set('Authorization', `Bearer ${body.token}`)
      .send({ senhaAtual: SENHA_INICIAL, novaSenha: SENHA_OUTRA })
      .expect(200);

    // Roda o seed DE NOVO, inclusive com a senha antiga na mão.
    await seedProducao(prisma, opcoes);

    // A senha trocada continua valendo; a inicial continua morta.
    await http.post('/auth/login').send({ login: adminLogin, senha: SENHA_OUTRA }).expect(201);
    await http.post('/auth/login').send({ login: adminLogin, senha: SENHA_INICIAL }).expect(401);
  });

  it('não sobrescreve configuração da empresa já ajustada pelo dono', async () => {
    await prisma.company.update({
      where: { id: companyId },
      data: { comissaoProdutosBp: 1500 },
    });
    await seedProducao(prisma, opcoes);
    const empresa = await prisma.company.findUnique({ where: { id: companyId } });
    expect(empresa?.comissaoProdutosBp).toBe(1500);
  });
});
