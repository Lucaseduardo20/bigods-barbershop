import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';
// ★ `IDENTITY_PROVIDER`/`DEMO_MODE` são ligados no `beforeAll`, NÃO aqui.
//
// O topo do módulo roda na IMPORTAÇÃO — todos os arquivos são importados antes
// de qualquer teste executar. Como `conta-cockpit.e2e.spec.ts` DELETA essas
// duas variáveis no `afterAll` dele, e os arquivos rodam no mesmo processo
// (`fileParallelism: false`), quem depende delas na hora de CRIAR o app
// precisa ligá-las na hora de criar o app. É a mesma armadilha descrita em
// `test/setup-env.ts`, e ela custou 11 testes falhando só na suíte inteira,
// nunca quando o arquivo rodava sozinho.

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import {
  ClienteSessaoService,
  JANELA_DE_VERIFICACAO_MS,
} from '../../src/modules/identity/infrastructure/cliente-sessao.service';
// eslint-disable-next-line import/first
import { Telefone } from '../../src/shared/domain/telefone';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';

/**
 * ★★ SENHA DO CLIENTE (2026-08-28) — nasceu de um incidente em produção.
 *
 * O provedor de SMS não entrega mais que ~2 códigos por número em curto
 * período. Com o login 100% OTP, o cliente que precisava de um segundo código
 * no mesmo dia ficava trancado para fora da própria conta.
 *
 * A identidade passa a ser TELEFONE + SENHA, e o código fica só onde prova
 * posse do telefone. O que este arquivo segura:
 *
 *  1. ★★ define a senha no primeiro acesso e depois entra SEM gastar código;
 *  2. ★★ "esqueci a senha": código verifica, senha nova vale, a antiga não;
 *  3. ★★ a senha é HASHEADA pelo motor do staff — nada em texto puro no banco;
 *  4. ★★ sessão antiga NÃO define senha (aparelho esquecido não vira senha alheia);
 *  5. ★  cliente pré-existente, que nunca teve senha, entra por caminho seguro;
 *  6. ★  telefone inexistente responde IGUAL a senha errada (anti-enumeração);
 *  7. ★  auditoria: código gerado e usado ficam registrados, o código nunca.
 */

const companyId = `co-senha-${randomUUID()}`;
const servicoId = `svc-senha-${randomUUID()}`;
const barbeiroId = `bar-senha-${randomUUID()}`;

const adminLogin = `adm-senha-${randomUUID().slice(0, 8)}`;
const barbeiroComumLogin = `bar-senha-${randomUUID().slice(0, 8)}`;
const SENHA_STAFF = 'bigods123';

const SENHA = 'corte-secreto-9';
const OUTRA_SENHA = 'barba-nova-2026';

let app: INestApplication;
let prisma: PrismaService;
let http: ReturnType<typeof request>;
let sessoes: ClienteSessaoService;
let tokenAdmin: string;
let tokenBarbeiro: string;

const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(40 + n++).slice(0, 2)}${sufixo}`;

/** Passo 1 do código: pede e devolve o desafio + o código (modo demo). */
async function pedirCodigo(telefone: string, rota = '/conta/login/iniciar', corpoExtra = {}) {
  const r = await http.post(rota).send({ companyId, telefone, ...corpoExtra }).expect(201);
  if (!r.body.codigoDemo) {
    // Sem isto o sintoma vira "esperava 201, veio 400" lá na frente, e o
    // culpado (o app subiu sem modo demo, porque outro arquivo apagou a
    // variável) fica invisível. Ver o comentário do topo do arquivo.
    throw new Error(
      'O app subiu SEM modo demo — `codigoDemo` veio vazio. ' +
        'Alguma coisa mexeu em IDENTITY_PROVIDER/DEMO_MODE entre o beforeAll e agora.',
    );
  }
  return { desafio: r.body.desafio as string, codigo: r.body.codigoDemo as string };
}

/** O caminho da ponte do funil: confirma o código e sai com sessão verificada. */
async function sessaoVerificada(telefone: string, nome = 'Cliente Senha') {
  const { desafio, codigo } = await pedirCodigo(telefone);
  const r = await http
    .post('/conta/login/confirmar')
    .send({ companyId, telefone, codigo, desafio, nome })
    .expect(201);
  return { token: r.body.token as string, clienteId: r.body.cliente.id as string };
}

const definirSenha = (token: string, senha: string) =>
  http.post('/conta/senha').set('Authorization', `Bearer ${token}`).send({ senha });

const entrarComSenha = (telefone: string, senha: string) =>
  http.post('/conta/login/senha').send({ companyId, telefone, senha });

/** Guardados para devolver o ambiente como estava — ver o comentário do topo. */
let identityProviderAnterior: string | undefined;
let demoModeAnterior: string | undefined;

beforeAll(async () => {
  identityProviderAnterior = process.env.IDENTITY_PROVIDER;
  demoModeAnterior = process.env.DEMO_MODE;
  process.env.IDENTITY_PROVIDER = 'demo';
  process.env.DEMO_MODE = 'true';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  prisma = app.get(PrismaService);
  sessoes = app.get(ClienteSessaoService);
  http = request(app.getHttpServer());

  await prisma.company.create({
    data: { id: companyId, nome: 'Bigod Senha', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: servicoId, companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.createMany({
    data: [
      {
        id: barbeiroId,
        companyId,
        nome: 'Dono Senha',
        slug: `dono-senha-${randomUUID().slice(0, 8)}`,
        papeis: ['ADMIN', 'BARBEIRO'],
        comissaoPadraoBp: 5000,
        login: adminLogin,
        senhaHash: hashSenha(SENHA_STAFF),
      },
      {
        id: `bar-comum-${randomUUID()}`,
        companyId,
        nome: 'Barbeiro Comum',
        slug: `bar-comum-${randomUUID().slice(0, 8)}`,
        papeis: ['BARBEIRO'],
        comissaoPadraoBp: 5000,
        login: barbeiroComumLogin,
        senhaHash: hashSenha(SENHA_STAFF),
      },
    ],
  });

  tokenAdmin = (await http.post('/auth/login').send({ login: adminLogin, senha: SENHA_STAFF }).expect(201)).body.token;
  tokenBarbeiro = (
    await http.post('/auth/login').send({ login: barbeiroComumLogin, senha: SENHA_STAFF }).expect(201)
  ).body.token;
});

afterAll(async () => {
  if (identityProviderAnterior === undefined) delete process.env.IDENTITY_PROVIDER;
  else process.env.IDENTITY_PROVIDER = identityProviderAnterior;
  if (demoModeAnterior === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = demoModeAnterior;

  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.eventoDoClube.deleteMany({ where: { companyId } });
  await prisma.cliente.deleteMany({ where: { companyId } });
  await prisma.barbeiro.deleteMany({ where: { companyId } });
  await prisma.servico.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await app.close();
});

describe('★★ primeiro acesso: define a senha e entra sem gastar código', () => {
  it('a ponte do funil define a senha SEM um segundo código', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);

    // A conta se descreve: ainda sem senha, e pode definir agora.
    const perfil = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
    expect(perfil.body.senha).toEqual({ definida: false, podeDefinirAgora: true });

    await definirSenha(token, SENHA).expect(201);

    const depois = await http.get('/conta/perfil').set('Authorization', `Bearer ${token}`).expect(200);
    expect(depois.body.senha.definida).toBe(true);
  });

  it('★★ e a partir daí entra só com telefone + senha — nenhum código enviado', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    await definirSenha(token, SENHA).expect(201);

    const codigosAntes = await prisma.demoDesafioLogin.count({ where: { companyId, telefone: Telefone.de(fone).e164 } });

    const login = await entrarComSenha(fone, SENHA).expect(201);
    expect(login.body.token).toBeTruthy();
    expect(login.body.cliente.telefone).toBe(Telefone.de(fone).e164);

    // ★ o ponto da feature: o login não gerou desafio nenhum.
    const codigosDepois = await prisma.demoDesafioLogin.count({ where: { companyId, telefone: Telefone.de(fone).e164 } });
    expect(codigosDepois).toBe(codigosAntes);

    // E a sessão do login por senha serve para usar a conta.
    await http.get('/conta/perfil').set('Authorization', `Bearer ${login.body.token}`).expect(200);
  });

  it('senha errada não entra', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    await definirSenha(token, SENHA).expect(201);
    await entrarComSenha(fone, 'outra-coisa-9').expect(401);
  });

  it('★★ o banco guarda HASH, nunca a senha', async () => {
    const fone = novoFone();
    const { token, clienteId } = await sessaoVerificada(fone);
    await definirSenha(token, SENHA).expect(201);

    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    expect(cliente.senhaHash).toBeTruthy();
    expect(cliente.senhaHash).not.toContain(SENHA);
    // Mesmo formato do login de staff: `sal:hash`, ambos hex.
    expect(cliente.senhaHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('recusa senha fraca, e diz por quê', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    const curta = await definirSenha(token, '1234');
    expect(curta.status).toBe(400);

    const obvia = await definirSenha(token, '12345678');
    expect(obvia.status).toBe(400);
    expect(JSON.stringify(obvia.body)).toContain('adivinhar');
  });

  it('★ recusa a senha igual ao próprio telefone', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    const res = await definirSenha(token, fone.replace(/\D/g, ''));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('telefone');
  });
});

describe('★★ sessão antiga não define senha', () => {
  it('quem está logado há mais de 30 min precisa verificar o telefone de novo', async () => {
    const fone = novoFone();
    const { clienteId } = await sessaoVerificada(fone);

    // Mesma sessão, verificada um minuto ALÉM da janela.
    const antiga = sessoes.emitir({
      clienteId,
      companyId,
      sub: 'demo-sub',
      verificadoEm: Date.now() - JANELA_DE_VERIFICACAO_MS - 60_000,
    });

    const res = await definirSenha(antiga, SENHA);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('confirme seu telefone'.split(' ')[0]);

    const cliente = await prisma.cliente.findUniqueOrThrow({ where: { id: clienteId } });
    expect(cliente.senhaHash).toBeNull();
  });

  it('★ sessão emitida pelo LOGIN POR SENHA também não define senha', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    await definirSenha(token, SENHA).expect(201);

    // Entrou com senha: não provou posse do telefone nesta sessão.
    const login = await entrarComSenha(fone, SENHA).expect(201);
    const res = await definirSenha(login.body.token, OUTRA_SENHA);
    expect(res.status).toBe(403);
  });

  it('★ token de antes desta mudança (sem o campo) não define senha', async () => {
    const fone = novoFone();
    const { clienteId } = await sessaoVerificada(fone);
    // `verificadoEm: null` é exatamente como um token antigo é lido.
    const antigo = sessoes.emitir({ clienteId, companyId, sub: 'demo-sub', verificadoEm: null });
    await definirSenha(antigo, SENHA).expect(403);
  });
});

describe('★★ esqueci minha senha', () => {
  it('código verifica, senha nova passa a valer e a antiga não', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    await definirSenha(token, SENHA).expect(201);

    const { desafio, codigo } = await pedirCodigo(fone, '/conta/senha/recuperar/iniciar');
    const res = await http
      .post('/conta/senha/recuperar/confirmar')
      .send({ companyId, telefone: fone, codigo, desafio, senha: OUTRA_SENHA })
      .expect(201);
    // Sai já logado: não digita duas vezes a senha que acabou de escolher.
    expect(res.body.token).toBeTruthy();

    await entrarComSenha(fone, OUTRA_SENHA).expect(201);
    await entrarComSenha(fone, SENHA).expect(401);
  });

  it('código errado não troca a senha', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    await definirSenha(token, SENHA).expect(201);

    const { desafio } = await pedirCodigo(fone, '/conta/senha/recuperar/iniciar');
    await http
      .post('/conta/senha/recuperar/confirmar')
      .send({ companyId, telefone: fone, codigo: '000000', desafio, senha: OUTRA_SENHA })
      .expect(401);

    // A senha antiga continua valendo — nada foi gravado.
    await entrarComSenha(fone, SENHA).expect(201);
  });

  it('★ é também o primeiro acesso de quem já era cliente e nunca teve senha', async () => {
    // Cliente pré-existente: criado sem senha, como todo mundo hoje.
    const fone = novoFone();
    const clienteId = randomUUID();
    await prisma.cliente.create({
      data: { id: clienteId, companyId, nome: 'Cliente Antigo', telefone: Telefone.de(fone).e164 },
    });

    await entrarComSenha(fone, SENHA).expect(401); // ainda não tem senha

    const { desafio, codigo } = await pedirCodigo(fone, '/conta/senha/recuperar/iniciar');
    await http
      .post('/conta/senha/recuperar/confirmar')
      .send({ companyId, telefone: fone, codigo, desafio, senha: SENHA })
      .expect(201);

    await entrarComSenha(fone, SENHA).expect(201);
    // E é o MESMO cliente, não um duplicado.
    const clientes = await prisma.cliente.findMany({ where: { companyId, telefone: Telefone.de(fone).e164 } });
    expect(clientes).toHaveLength(1);
    expect(clientes[0]!.id).toBe(clienteId);
  });
});

describe('★ anti-enumeração', () => {
  it('telefone que não existe responde igual a senha errada', async () => {
    const fone = novoFone();
    const { token } = await sessaoVerificada(fone);
    await definirSenha(token, SENHA).expect(201);

    const inexistente = await entrarComSenha(novoFone(), SENHA);
    const senhaErrada = await entrarComSenha(fone, 'nao-e-essa-1');

    expect(inexistente.status).toBe(senhaErrada.status);
    expect(inexistente.body.message).toBe(senhaErrada.body.message);
  });

  it('cliente sem senha definida responde igual também', async () => {
    const fone = novoFone();
    await sessaoVerificada(fone); // existe, mas nunca definiu senha
    const semSenha = await entrarComSenha(fone, SENHA);
    const inexistente = await entrarComSenha(novoFone(), SENHA);
    expect(semSenha.status).toBe(inexistente.status);
    expect(semSenha.body.message).toBe(inexistente.body.message);
  });
});

describe('★ auditoria de código', () => {
  it('registra gerado e usado, com a finalidade — e nunca o código', async () => {
    const fone = novoFone();
    const e164 = Telefone.de(fone).e164;

    // Um código de recuperação, usado.
    const { desafio, codigo } = await pedirCodigo(fone, '/conta/senha/recuperar/iniciar');
    await http
      .post('/conta/senha/recuperar/confirmar')
      .send({ companyId, telefone: fone, codigo, desafio, senha: SENHA })
      .expect(201);

    // Outro, pedido e NÃO usado — o caso do cliente que liga dizendo que não
    // recebeu: o dono precisa ver que saiu e que ninguém usou.
    await pedirCodigo(fone, '/conta/senha/recuperar/iniciar');

    const linhas = await prisma.demoDesafioLogin.findMany({
      where: { companyId, telefone: e164 },
      orderBy: { criadoEm: 'asc' },
    });
    const recuperacoes = linhas.filter((l) => l.finalidade === 'RECUPERAR_SENHA');
    expect(recuperacoes).toHaveLength(2);
    expect(recuperacoes[0]!.consumidoEm).not.toBeNull();
    expect(recuperacoes[1]!.consumidoEm).toBeNull();
    expect(recuperacoes[0]!.criadoEm).toBeTruthy();

    // ★ o código nunca é recuperável: só o HMAC.
    for (const linha of linhas) {
      expect(linha.codigoHash).not.toContain(codigo);
      expect(linha.codigoHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('a confirmação de agendamento é distinguível da recuperação', async () => {
    const fone = novoFone();
    await pedirCodigo(fone, '/conta/login/iniciar', { finalidade: 'CONFIRMAR_AGENDAMENTO' });
    const linha = await prisma.demoDesafioLogin.findFirstOrThrow({
      where: { companyId, telefone: Telefone.de(fone).e164 },
      orderBy: { criadoEm: 'desc' },
    });
    expect(linha.finalidade).toBe('CONFIRMAR_AGENDAMENTO');
  });
});

describe('★ o dono vê os códigos no painel', () => {
  it('lista gerado/usado com a finalidade — e NUNCA o código', async () => {
    const fone = novoFone();
    const { desafio, codigo } = await pedirCodigo(fone, '/conta/senha/recuperar/iniciar');
    await http
      .post('/conta/senha/recuperar/confirmar')
      .send({ companyId, telefone: fone, codigo, desafio, senha: SENHA })
      .expect(201);
    await pedirCodigo(fone, '/conta/senha/recuperar/iniciar'); // este ninguém usa

    const res = await http
      .get(`/otp/auditoria?telefone=${encodeURIComponent(fone)}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // O mais recente é o não usado — é o sintoma que o dono procura.
    expect(res.body[0].usadoEm).toBeNull();
    expect(res.body[0].finalidade).toBe('RECUPERAR_SENHA');
    expect(res.body.some((c: { usadoEm: string | null }) => c.usadoEm !== null)).toBe(true);

    // ★ nem o código, nem o hash dele, saem daqui.
    const corpo = JSON.stringify(res.body);
    expect(corpo).not.toContain(codigo);
    expect(corpo).not.toContain('codigoHash');
  });

  it('★ barbeiro comum não vê os códigos dos clientes', async () => {
    await http.get('/otp/auditoria').set('Authorization', `Bearer ${tokenBarbeiro}`).expect(403);
  });

  it('telefone mal digitado devolve vazio, não erro', async () => {
    const res = await http
      .get('/otp/auditoria?telefone=abc')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });
});
