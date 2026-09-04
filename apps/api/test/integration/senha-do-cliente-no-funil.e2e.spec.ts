import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';

// eslint-disable-next-line import/first
import { AppModule } from '../../src/app.module';
// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { hashSenha } from '../../src/modules/identity/infrastructure/local-auth.provider';
// eslint-disable-next-line import/first
import { Telefone } from '../../src/shared/domain/telefone';
// eslint-disable-next-line import/first
import { diaCivilChave, diaCivilMaisDias, instanteDeDataHoraLocal } from '../../src/shared/domain/calendario';
// eslint-disable-next-line import/first
import { Timezone } from '../../src/shared/domain/timezone';

/**
 * ★★ SENHA DO CLIENTE NO FUNIL (2026-09-04) — continuação da contingência.
 *
 * Com o SMS fora de operação, o passo do telefone ganhou três ramos, e o que
 * os separa é a CONTA, não a idade do cliente:
 *
 *  1. telefone SEM conta          → cria a própria senha ali, e a conta nasce
 *                                   com ela;
 *  2. telefone COM conta E senha  → entra com a senha, no lugar do código;
 *  3. telefone COM conta SEM senha→ ★★★ NUNCA cria senha aqui. É a trava de
 *                                   segurança deste arquivo: sem prova de posse
 *                                   do telefone, criar senha para uma conta que
 *                                   já existe entrega histórico, pacotes e
 *                                   créditos pagos a quem digitou o número
 *                                   primeiro. Quem destrava é o admin.
 *
 * O que mais está segurado aqui:
 *
 *  - a criação NÃO devolve sessão, e o agendamento continua nascendo pendente
 *    (a senha resolve acesso à conta, não prova telefone);
 *  - a senha vai ao banco no MESMO formato do login de staff (motor reusado);
 *  - trocar a própria senha exige a atual;
 *  - resposta neutra a telefone inexistente;
 *  - ★★ com a flag DESLIGADA, a rota de criação não existe (404) e nada regride.
 */

const tz = Timezone.de('America/Sao_Paulo');
const DIA = diaCivilMaisDias(diaCivilChave(new Date(), tz), 21);

const ligada = {
  companyId: `co-sf-on-${randomUUID()}`,
  servicoId: `svc-sf-on-${randomUUID()}`,
  barbeiroId: `bar-sf-on-${randomUUID()}`,
  login: `adm-sf-on-${randomUUID().slice(0, 8)}`,
};
const desligada = {
  companyId: `co-sf-off-${randomUUID()}`,
  servicoId: `svc-sf-off-${randomUUID()}`,
  barbeiroId: `bar-sf-off-${randomUUID()}`,
  login: `adm-sf-off-${randomUUID().slice(0, 8)}`,
};

const SENHA_STAFF = 'bigods123';
const SENHA_DO_FUNIL = 'navalha-quente7';
const SENHA_DO_ADMIN = 'tesoura-nova12';

let appOn: INestApplication;
let appOff: INestApplication;
let prisma: PrismaService;
let httpOn: ReturnType<typeof request>;
let httpOff: ReturnType<typeof request>;
let tokenOn: string;

const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(40 + n++).slice(0, 2)}${sufixo}`;

/** Sobe um app com a flag no valor pedido — ela é lida na criação do módulo. */
async function subirApp(contingencia: boolean): Promise<INestApplication> {
  const anterior = process.env.OTP_CONTINGENCIA;
  process.env.OTP_CONTINGENCIA = contingencia ? 'true' : 'false';
  // ★ Atribuído AQUI, e não no topo do módulo: `conta-cockpit.e2e.spec.ts`
  // apaga estas duas no `afterAll` dele, e a suíte inteira compartilha um
  // processo (`fileParallelism: false`). Ver `test/setup-env.ts`.
  process.env.IDENTITY_PROVIDER = 'demo';
  process.env.DEMO_MODE = 'true';
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    return app;
  } finally {
    if (anterior === undefined) delete process.env.OTP_CONTINGENCIA;
    else process.env.OTP_CONTINGENCIA = anterior;
  }
}

async function semear(cfg: typeof ligada) {
  await prisma.company.create({
    data: { id: cfg.companyId, nome: 'Bigod Senha no Funil', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: cfg.servicoId, companyId: cfg.companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: cfg.barbeiroId,
      companyId: cfg.companyId,
      nome: 'Barbeiro Senha',
      slug: `bar-sf-${randomUUID().slice(0, 8)}`,
      papeis: ['ADMIN', 'BARBEIRO'],
      comissaoPadraoBp: 5000,
      login: cfg.login,
      senhaHash: hashSenha(SENHA_STAFF),
    },
  });
  await prisma.barbeiroServico.create({ data: { barbeiroId: cfg.barbeiroId, servicoId: cfg.servicoId } });
  await prisma.disponibilidade.create({
    data: {
      id: `disp-${randomUUID()}`,
      barbeiroId: cfg.barbeiroId,
      data: DIA,
      inicio: instanteDeDataHoraLocal(DIA, '08:00', tz),
      fim: instanteDeDataHoraLocal(DIA, '20:00', tz),
    },
  });
}

async function limpar(cfg: typeof ligada) {
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId: cfg.companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.eventoDoClube.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.cliente.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.disponibilidade.deleteMany({ where: { barbeiroId: cfg.barbeiroId } });
  await prisma.barbeiroServico.deleteMany({ where: { barbeiroId: cfg.barbeiroId } });
  await prisma.barbeiro.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.servico.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.company.deleteMany({ where: { id: cfg.companyId } });
}

/** Cliente ANTIGO: existe, tem nome de verdade e nunca teve senha. */
async function clienteLegado(cfg: typeof ligada, nome: string): Promise<string> {
  const telefone = Telefone.de(novoFone()).e164;
  await prisma.cliente.create({
    data: { id: randomUUID(), companyId: cfg.companyId, nome, telefone, senhaHash: null },
  });
  return telefone;
}

function conhecido(http: ReturnType<typeof request>, cfg: typeof ligada, telefone: string) {
  return http.get(
    `/public/clientes/conhecido?companyId=${encodeURIComponent(cfg.companyId)}&telefone=${encodeURIComponent(telefone)}`,
  );
}

function criarSenha(
  http: ReturnType<typeof request>,
  cfg: typeof ligada,
  telefone: string,
  senha: string,
  nome = 'Cliente Novo',
) {
  return http.post('/conta/senha/criar').send({ companyId: cfg.companyId, telefone, nome, senha });
}

beforeAll(async () => {
  appOn = await subirApp(true);
  prisma = appOn.get(PrismaService);
  httpOn = request(appOn.getHttpServer());
  appOff = await subirApp(false);
  httpOff = request(appOff.getHttpServer());

  await semear(ligada);
  await semear(desligada);

  tokenOn = (await httpOn.post('/auth/login').send({ login: ligada.login, senha: SENHA_STAFF }).expect(201)).body.token;
});

afterAll(async () => {
  await limpar(ligada);
  await limpar(desligada);
  await appOn.close();
  await appOff.close();
});

describe('★ ramo 1 — telefone SEM conta cria a própria senha', () => {
  it('a conta nasce com a senha, e o funil passa a enxergá-la como "tem senha"', async () => {
    const telefone = novoFone();
    const antes = await conhecido(httpOn, ligada, telefone).expect(200);
    expect(antes.body).toEqual({ conhecido: false, temSenha: false });

    const criacao = await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL, 'Rafael do Funil').expect(201);
    // ★★ NÃO devolve sessão: a senha não prova posse do telefone, e um token
    // aqui faria o agendamento nascer firme — desmontando a contingência.
    expect(criacao.body).toEqual({ ok: true });
    expect(JSON.stringify(criacao.body)).not.toContain('token');

    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, telefone: Telefone.de(telefone).e164 },
    });
    expect(cliente.nome).toBe('Rafael do Funil');
    // Mesmo motor do login de staff: `sal:hash`, ambos hex. Nunca texto claro.
    expect(cliente.senhaHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(cliente.senhaHash).not.toContain(SENHA_DO_FUNIL);

    const depois = await conhecido(httpOn, ligada, telefone).expect(200);
    expect(depois.body).toEqual({ conhecido: true, temSenha: true });
  });

  it('★★ ele entra com a senha que criou, sem gerar código nenhum', async () => {
    const telefone = novoFone();
    await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL, 'Entra Com A Dele').expect(201);

    const login = await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone, senha: SENHA_DO_FUNIL })
      .expect(201);
    expect(login.body.token).toBeTruthy();

    const codigos = await prisma.demoDesafioLogin.count({
      where: { companyId: ligada.companyId, telefone: Telefone.de(telefone).e164 },
    });
    expect(codigos).toBe(0);
  });

  it('★★ o agendamento dele CONTINUA nascendo pendente de aprovação', async () => {
    const telefone = novoFone();
    await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL, 'Agenda Depois Da Senha').expect(201);

    // Mesmo caminho anônimo de sempre — a senha não vira sessão, e a proteção
    // da agenda continua sendo a aprovação manual.
    const res = await httpOn
      .post('/public/agendamentos')
      .send({
        companyId: ligada.companyId,
        barbeiroId: ligada.barbeiroId,
        servicoIds: [ligada.servicoId],
        data: DIA,
        horaInicio: '09:00',
        cliente: { telefone },
      })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('AGUARDANDO_APROVACAO');
  });

  it('senha fraca é recusada na borda, com a razão na mensagem', async () => {
    const res = await criarSenha(httpOn, ligada, novoFone(), '12345678');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('adivinhar');
  });

  it('senha igual ao próprio telefone é recusada — o telefone É o login', async () => {
    const telefone = novoFone();
    const res = await criarSenha(httpOn, ligada, telefone, telefone.replace(/\D/g, ''));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('telefone');
  });
});

describe('★★★ ramo 3 — conta que existe e NÃO tem senha: a trava', () => {
  it('★★★ o funil NÃO pode criar senha para ela, e a conta continua sem senha', async () => {
    const telefone = await clienteLegado(ligada, 'Cliente Antigo Com Historico');

    const res = await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('Fale com a barbearia');

    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, telefone },
    });
    expect(cliente.senhaHash).toBeNull();
    // E o nome dele continua o dele: a tentativa não reescreveu nada.
    expect(cliente.nome).toBe('Cliente Antigo Com Historico');
  });

  it('é assim que o funil sabe mandar falar com a barbearia', async () => {
    const telefone = await clienteLegado(ligada, 'Outro Antigo');
    const res = await conhecido(httpOn, ligada, telefone).expect(200);
    expect(res.body).toEqual({ conhecido: true, temSenha: false });
  });

  it('★★ e o admin destrava: define a senha, e aí sim o cliente entra', async () => {
    const telefone = await clienteLegado(ligada, 'Destravado Pelo Admin');
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, telefone },
    });

    await httpOn
      .post(`/clientes/${cliente.id}/senha`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .send({ senha: SENHA_DO_ADMIN })
      .expect(201);

    await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone, senha: SENHA_DO_ADMIN })
      .expect(201);
  });

  it('conta que JÁ tem senha também não passa pela criação do funil', async () => {
    const telefone = novoFone();
    await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL, 'Ja Tem Senha').expect(201);
    const segunda = await criarSenha(httpOn, ligada, telefone, 'outra-senha-44', 'Impostor');
    expect(segunda.status).toBe(409);

    // A senha original continua valendo — a segunda tentativa não trocou nada.
    await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone, senha: SENHA_DO_FUNIL })
      .expect(201);
  });

  it('★★ ele AGENDA mesmo assim — e o nome do cadastro dele não é tocado', async () => {
    const telefone = await clienteLegado(ligada, 'Nome Original Do Cadastro');

    // O funil não pergunta o nome de quem já tem cadastro e não pôde ser
    // identificado; então ele também não manda nenhum. Fechar a porta aqui
    // deixaria o cliente antigo sem conseguir marcar — o desfecho que a
    // contingência inteira existe para evitar.
    const res = await httpOn
      .post('/public/agendamentos')
      .send({
        companyId: ligada.companyId,
        barbeiroId: ligada.barbeiroId,
        servicoIds: [ligada.servicoId],
        data: DIA,
        horaInicio: '15:00',
        cliente: { telefone },
      })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('AGUARDANDO_APROVACAO');

    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, telefone },
    });
    expect(cliente.nome).toBe('Nome Original Do Cadastro');
    expect(cliente.senhaHash).toBeNull();
  });

  it('★ telefone inexistente responde IGUAL a senha errada (anti-enumeração)', async () => {
    const telefone = novoFone();
    await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL, 'Existe De Fato').expect(201);

    const inexistente = await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone: novoFone(), senha: SENHA_DO_FUNIL });
    const senhaErrada = await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone, senha: 'nao-e-essa-1' });

    expect(inexistente.status).toBe(senhaErrada.status);
    expect(inexistente.body.message).toBe(senhaErrada.body.message);
  });
});

describe('★ o cliente troca a própria senha', () => {
  it('★★ exige a senha ATUAL — e depois só a nova vale', async () => {
    const telefone = novoFone();
    await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL, 'Vai Trocar').expect(201);
    const token = (
      await httpOn
        .post('/conta/login/senha')
        .send({ companyId: ligada.companyId, telefone, senha: SENHA_DO_FUNIL })
        .expect(201)
    ).body.token;

    // Sem a senha atual não troca: a sessão dura 30 dias e vive num celular.
    await httpOn
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: 'chute-errado-9', novaSenha: 'pomada-fresca8' })
      .expect(401);

    await httpOn
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: SENHA_DO_FUNIL, novaSenha: 'pomada-fresca8' })
      .expect(200);

    await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone, senha: 'pomada-fresca8' })
      .expect(201);
    await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone, senha: SENHA_DO_FUNIL })
      .expect(401);
  });

  it('sem sessão não troca nada', async () => {
    await httpOn
      .put('/conta/senha')
      .send({ senhaAtual: SENHA_DO_FUNIL, novaSenha: 'espelho-limpo3' })
      .expect(401);
  });

  it('a nova senha precisa ser diferente da atual, e passar na política', async () => {
    const telefone = novoFone();
    await criarSenha(httpOn, ligada, telefone, SENHA_DO_FUNIL, 'Repete A Mesma').expect(201);
    const token = (
      await httpOn
        .post('/conta/login/senha')
        .send({ companyId: ligada.companyId, telefone, senha: SENHA_DO_FUNIL })
        .expect(201)
    ).body.token;

    await httpOn
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: SENHA_DO_FUNIL, novaSenha: SENHA_DO_FUNIL })
      .expect(400);

    await httpOn
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: SENHA_DO_FUNIL, novaSenha: '12345678' })
      .expect(400);
  });
});

describe('★★ flag DESLIGADA: nada disso existe, e nada regride', () => {
  it('★★ a rota de criar senha no funil não existe (404)', async () => {
    const res = await criarSenha(httpOff, desligada, novoFone(), SENHA_DO_FUNIL);
    expect(res.status).toBe(404);
  });

  it('★ e nenhuma conta foi criada por essa tentativa', async () => {
    const telefone = novoFone();
    await criarSenha(httpOff, desligada, telefone, SENHA_DO_FUNIL).expect(404);
    const cliente = await prisma.cliente.findFirst({
      where: { companyId: desligada.companyId, telefone: Telefone.de(telefone).e164 },
    });
    expect(cliente).toBeNull();
  });

  it('★ `conhecido` volta a ser só um booleano — `temSenha` nem é respondido', async () => {
    const telefone = await clienteLegado(desligada, 'Antigo Fora Da Contingencia');
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: desligada.companyId, telefone },
    });
    await prisma.cliente.update({
      where: { id: cliente.id },
      data: { senhaHash: hashSenha(SENHA_DO_ADMIN) },
    });

    const res = await conhecido(httpOff, desligada, telefone).expect(200);
    // Tem senha de verdade, e mesmo assim o campo vem `false`: fora da
    // contingência ninguém consome, e um oráculo sem uso não deve existir.
    expect(res.body).toEqual({ conhecido: true, temSenha: false });
  });

  it('★ trocar a própria senha continua funcionando — é recurso permanente', async () => {
    const telefone = await clienteLegado(desligada, 'Troca Sem Contingencia');
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: desligada.companyId, telefone },
    });
    await prisma.cliente.update({
      where: { id: cliente.id },
      data: { senhaHash: hashSenha(SENHA_DO_ADMIN) },
    });

    const token = (
      await httpOff
        .post('/conta/login/senha')
        .send({ companyId: desligada.companyId, telefone, senha: SENHA_DO_ADMIN })
        .expect(201)
    ).body.token;

    await httpOff
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: SENHA_DO_ADMIN, novaSenha: 'cadeira-alta21' })
      .expect(200);
  });

  it('★★ sem regressão: presencial anônimo continua exigindo o código (401)', async () => {
    const res = await httpOff.post('/public/agendamentos').send({
      companyId: desligada.companyId,
      barbeiroId: desligada.barbeiroId,
      servicoIds: [desligada.servicoId],
      data: DIA,
      horaInicio: '09:00',
      cliente: { nome: 'Sem Sessao', telefone: novoFone() },
    });
    expect(res.status).toBe(401);
  });

  it('cliente SEM senha não "define" uma pela troca — precisa do admin', async () => {
    const telefone = await clienteLegado(desligada, 'Sem Senha Nenhuma');
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: desligada.companyId, telefone },
    });
    await prisma.cliente.update({
      where: { id: cliente.id },
      data: { senhaHash: hashSenha(SENHA_DO_ADMIN) },
    });
    const token = (
      await httpOff
        .post('/conta/login/senha')
        .send({ companyId: desligada.companyId, telefone, senha: SENHA_DO_ADMIN })
        .expect(201)
    ).body.token;
    // Some a senha por baixo da sessão: é o retrato de quem entrou por outro
    // caminho e não tem senha para provar.
    await prisma.cliente.update({ where: { id: cliente.id }, data: { senhaHash: null } });

    const res = await httpOff
      .put('/conta/senha')
      .set('Authorization', `Bearer ${token}`)
      .send({ senhaAtual: SENHA_DO_ADMIN, novaSenha: 'toalha-quente5' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('barbearia');
  });
});
