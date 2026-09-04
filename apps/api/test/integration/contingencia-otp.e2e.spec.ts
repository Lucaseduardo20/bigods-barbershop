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
 * ★★ CONTINGÊNCIA DE OTP (2026-09-04) — INCIDENTE EM PRODUÇÃO.
 *
 * O SMS de verificação parou de chegar de forma confiável (rota do provedor,
 * não código): o cliente não conseguia agendar nem entrar na conta. A saída é
 * um DESVIO por flag, reversível — o OTP continua inteiro no código.
 *
 * O que este arquivo segura:
 *
 *  1. ★★ flag ON: agenda sem verificar telefone, e o pedido nasce
 *     AGUARDANDO_APROVACAO — o filtro vira uma pessoa, não some;
 *  2. ★★ o pendente OCUPA o horário (dois pedidos não brigam pelo mesmo);
 *  3. ★★ aprovar torna firme; recusar cancela com motivo e libera o horário;
 *  4. ★★ flag OFF: NADA muda — presencial sem sessão continua 401;
 *  5. ★  a cota de presenciais continua valendo com a flag ligada;
 *  6. ★★ o admin define senha e o cliente entra SEM SMS;
 *  7. ★  senha guardada como hash, nunca em texto;
 *  8. ★  resposta neutra a telefone inexistente (anti-enumeração).
 */

const tz = Timezone.de('America/Sao_Paulo');
const DIA = diaCivilMaisDias(diaCivilChave(new Date(), tz), 12);

/** Ambiente com a flag LIGADA e outro com ela desligada — dois apps, um arquivo. */
const ligada = {
  companyId: `co-cont-on-${randomUUID()}`,
  servicoId: `svc-cont-on-${randomUUID()}`,
  barbeiroId: `bar-cont-on-${randomUUID()}`,
  login: `adm-cont-on-${randomUUID().slice(0, 8)}`,
};
const desligada = {
  companyId: `co-cont-off-${randomUUID()}`,
  servicoId: `svc-cont-off-${randomUUID()}`,
  barbeiroId: `bar-cont-off-${randomUUID()}`,
  login: `adm-cont-off-${randomUUID().slice(0, 8)}`,
};

const SENHA_STAFF = 'bigods123';
const SENHA_CLIENTE = 'corte-do-mes-9';

let appOn: INestApplication;
let appOff: INestApplication;
let prisma: PrismaService;
let httpOn: ReturnType<typeof request>;
let httpOff: ReturnType<typeof request>;
let tokenOn: string;
let tokenOff: string;

const sufixo = String(Date.now()).slice(-6);
let n = 0;
const novoFone = () => `11 9${String(30 + n++).slice(0, 2)}${sufixo}`;

/** Sobe um app com a flag no valor pedido — ela é lida na criação do módulo. */
async function subirApp(contingencia: boolean): Promise<INestApplication> {
  const anterior = process.env.OTP_CONTINGENCIA;
  process.env.OTP_CONTINGENCIA = contingencia ? 'true' : 'false';
  process.env.IDENTITY_PROVIDER = 'demo';
  process.env.DEMO_MODE = 'true';
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    return app;
  } finally {
    // Restaura na hora: o próximo app do arquivo (e os outros arquivos da
    // suíte) não podem herdar a flag de quem subiu antes.
    if (anterior === undefined) delete process.env.OTP_CONTINGENCIA;
    else process.env.OTP_CONTINGENCIA = anterior;
  }
}

async function semear(cfg: typeof ligada) {
  await prisma.company.create({
    data: { id: cfg.companyId, nome: 'Bigod Contingência', timezone: 'America/Sao_Paulo' },
  });
  await prisma.servico.create({
    data: { id: cfg.servicoId, companyId: cfg.companyId, nome: 'Corte', precoAvulsoCentavos: 4000, duracaoMinutos: 30 },
  });
  await prisma.barbeiro.create({
    data: {
      id: cfg.barbeiroId,
      companyId: cfg.companyId,
      nome: 'Barbeiro Contingência',
      slug: `bar-cont-${randomUUID().slice(0, 8)}`,
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
  await prisma.lancamentoComissao.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.itemDoPacote.deleteMany({ where: { venda: { companyId: cfg.companyId } } });
  await prisma.itemAtendido.deleteMany({ where: { atendimento: { companyId: cfg.companyId } } });
  await prisma.atendimento.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.vendaDePacote.deleteMany({ where: { companyId: cfg.companyId } });
  await prisma.intencaoDePagamento.deleteMany({ where: { companyId: cfg.companyId } });
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

/** Agendamento presencial pelo funil, ANÔNIMO (sem sessão de OTP). */
function agendarAnonimo(http: ReturnType<typeof request>, cfg: typeof ligada, hora: string, telefone: string) {
  return http.post('/public/agendamentos').send({
    companyId: cfg.companyId,
    barbeiroId: cfg.barbeiroId,
    servicoIds: [cfg.servicoId],
    data: DIA,
    horaInicio: hora,
    cliente: { nome: 'Cliente Contingência', telefone },
  });
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
  tokenOff = (await httpOff.post('/auth/login').send({ login: desligada.login, senha: SENHA_STAFF }).expect(201)).body.token;
});

afterAll(async () => {
  await limpar(ligada);
  await limpar(desligada);
  await appOn.close();
  await appOff.close();
});

describe('★★ flag LIGADA: agenda sem OTP, mas pendente de aprovação', () => {
  it('o funil aceita o agendamento anônimo e ele nasce AGUARDANDO_APROVACAO', async () => {
    const res = await agendarAnonimo(httpOn, ligada, '09:00', novoFone()).expect(201);
    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('AGUARDANDO_APROVACAO');
  });

  it('★ enquanto espera decisão, o horário é DELE — o segundo pedido é recusado', async () => {
    await agendarAnonimo(httpOn, ligada, '10:00', novoFone()).expect(201);
    const conflito = await agendarAnonimo(httpOn, ligada, '10:00', novoFone());
    expect(conflito.status).toBeGreaterThanOrEqual(400);
    // ★ E recusado como REGRA DE NEGÓCIO, não como erro de banco. O domínio
    // precisa enxergar o pendente como ocupante: se só a EXCLUDE barrar, o
    // cliente leva um 500 genérico no último clique do funil.
    expect(conflito.status).toBeLessThan(500);
  });

  it('★★ e o horário do pendente SOME da lista de livres', async () => {
    const res = await agendarAnonimo(httpOn, ligada, '15:00', novoFone()).expect(201);
    expect(res.body.atendimentoId).toBeTruthy();

    const horarios = await httpOn
      .get(
        `/public/horarios?companyId=${encodeURIComponent(ligada.companyId)}` +
          `&barbeiroId=${ligada.barbeiroId}&servicoIds=${ligada.servicoId}&data=${DIA}`,
      )
      .expect(200);
    const inicios: string[] = horarios.body.horarios.map((h: { horaInicio: string }) => h.horaInicio);

    // Oferecer 15:00 aqui era o defeito: o funil inteiro andava e só o último
    // clique descobria que o horário já era de outra pessoa.
    expect(inicios).not.toContain('15:00');
    // E o serviço dura 30 min: 14:45 também não cabe mais.
    expect(inicios).not.toContain('14:45');
    // Longe do pendente, a agenda continua aberta — o filtro não é um facão.
    expect(inicios).toContain('08:00');
  });

  it('★★ o pendente aparece como PRÓXIMO do cliente — nunca no histórico', async () => {
    const telefone = novoFone();
    const res = await agendarAnonimo(httpOn, ligada, '16:00', telefone).expect(201);

    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, telefone: Telefone.de(telefone).e164 },
    });
    // Pelo painel, na MESMA tela em que o dono decide se aprova: dizer "nenhum
    // horário marcado" ali é esconder o que ele está prestes a julgar.
    const detalhe = await httpOn
      .get(`/clientes/${cliente.id}`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .expect(200);
    const ids: string[] = detalhe.body.proximosAgendamentos.map(
      (a: { atendimentoId: string }) => a.atendimentoId,
    );
    expect(ids).toContain(res.body.atendimentoId);

    // E pelo app da conta: futuro é futuro. Aparecer no histórico seria mostrar
    // ao cliente, como coisa passada, um horário que ainda vai acontecer.
    await httpOn
      .post(`/clientes/${cliente.id}/senha`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .send({ senha: SENHA_CLIENTE })
      .expect(201);
    const login = await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone, senha: SENHA_CLIENTE })
      .expect(201);
    const perfil = await httpOn
      .get('/conta/perfil')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    const historico = await httpOn
      .get('/conta/historico')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    expect(
      perfil.body.proximosAgendamentos.map((a: { atendimentoId: string }) => a.atendimentoId),
    ).toContain(res.body.atendimentoId);
    expect(
      historico.body.map((a: { atendimentoId: string }) => a.atendimentoId),
    ).not.toContain(res.body.atendimentoId);
  });

  it('★★ aprovar torna firme — e é só aí que o agendamento existe', async () => {
    const res = await agendarAnonimo(httpOn, ligada, '11:00', novoFone()).expect(201);
    await httpOn
      .post(`/atendimentos/${res.body.atendimentoId}/aprovar-agendamento`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('AGENDADO');
    // Rastro da decisão humana, que substituiu a trava automática.
    expect(atendimento.aprovadoPorId).toBe(ligada.barbeiroId);
    expect(atendimento.aprovadoEm).not.toBeNull();
  });

  it('★★ recusar cancela com motivo e devolve o horário', async () => {
    const res = await agendarAnonimo(httpOn, ligada, '12:00', novoFone()).expect(201);
    await httpOn
      .post(`/atendimentos/${res.body.atendimentoId}/recusar-agendamento`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .send({ motivo: 'número não confere' })
      .expect(201);

    const atendimento = await prisma.atendimento.findUniqueOrThrow({
      where: { id: res.body.atendimentoId },
    });
    expect(atendimento.status).toBe('CANCELADO');
    expect(atendimento.motivoCancelamento).toBe('número não confere');

    // Horário livre de novo: outro cliente consegue o mesmo 12:00.
    await agendarAnonimo(httpOn, ligada, '12:00', novoFone()).expect(201);
  });

  it('recusar exige motivo', async () => {
    const res = await agendarAnonimo(httpOn, ligada, '13:00', novoFone()).expect(201);
    await httpOn
      .post(`/atendimentos/${res.body.atendimentoId}/recusar-agendamento`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .send({ motivo: '   ' })
      .expect(400);
  });

  it('aprovar duas vezes não passa — o estado já não é mais pendente', async () => {
    const res = await agendarAnonimo(httpOn, ligada, '14:00', novoFone()).expect(201);
    const url = `/atendimentos/${res.body.atendimentoId}/aprovar-agendamento`;
    await httpOn.post(url).set('Authorization', `Bearer ${tokenOn}`).expect(201);
    const segunda = await httpOn.post(url).set('Authorization', `Bearer ${tokenOn}`);
    expect(segunda.status).toBeGreaterThanOrEqual(400);
  });

  it('★ a cota de presenciais continua valendo com a flag ligada', async () => {
    const fone = novoFone();
    // A cota é por cliente; o mesmo telefone marcando em série.
    const horas = ['15:00', '15:30', '16:00', '16:30'];
    const respostas = [];
    for (const hora of horas) respostas.push(await agendarAnonimo(httpOn, ligada, hora, fone));
    // Em algum ponto a cota barra — a contingência não afrouxou essa trava.
    expect(respostas.some((r) => r.status >= 400)).toBe(true);
  });
});

describe('★★ flag DESLIGADA: nada muda', () => {
  it('presencial sem sessão continua exigindo o telefone confirmado', async () => {
    const res = await agendarAnonimo(httpOff, desligada, '09:00', novoFone());
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toContain('Confirme seu telefone');
  });

  it('★ e nenhum atendimento nasce pendente neste ambiente', async () => {
    const pendentes = await prisma.atendimento.count({
      where: { companyId: desligada.companyId, status: 'AGUARDANDO_APROVACAO' },
    });
    expect(pendentes).toBe(0);
  });
});

describe('★★ o admin destrava o cliente que pagou', () => {
  it('lista clientes dizendo quem tem senha e quantos créditos vivos', async () => {
    const fone = novoFone();
    const venda = await httpOn
      .post('/pacotes')
      .set('Authorization', `Bearer ${tokenOn}`)
      .send({
        cliente: { nome: 'Cliente Com Pacote', telefone: fone },
        servicoIds: [ligada.servicoId, ligada.servicoId],
        valorPagoCentavos: 7000,
        pagamentoImediato: true,
      })
      .expect(201);
    expect(venda.body.vendaId).toBeTruthy();

    const lista = await httpOn.get('/clientes').set('Authorization', `Bearer ${tokenOn}`).expect(200);
    const cliente = lista.body.find((c: { telefone: string }) => c.telefone === Telefone.de(fone).e164);
    expect(cliente.temSenha).toBe(false);
    expect(cliente.creditosDisponiveis).toBe(2);
  });

  it('mostra o detalhe com pacotes e agendamentos', async () => {
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, nome: 'Cliente Com Pacote' },
    });
    const res = await httpOn
      .get(`/clientes/${cliente.id}`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .expect(200);
    expect(res.body.cliente.nome).toBe('Cliente Com Pacote');
    expect(res.body.pacotes).toHaveLength(1);
    expect(Array.isArray(res.body.proximosAgendamentos)).toBe(true);
  });

  it('★★ define a senha e o cliente entra SEM SMS — depois usa o crédito', async () => {
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, nome: 'Cliente Com Pacote' },
    });

    await httpOn
      .post(`/clientes/${cliente.id}/senha`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .send({ senha: SENHA_CLIENTE })
      .expect(201);

    // Nenhum código foi gerado neste login: é o ponto da contingência.
    const codigosAntes = await prisma.demoDesafioLogin.count({
      where: { companyId: ligada.companyId, telefone: cliente.telefone },
    });
    const login = await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone: cliente.telefone, senha: SENHA_CLIENTE })
      .expect(201);
    const codigosDepois = await prisma.demoDesafioLogin.count({
      where: { companyId: ligada.companyId, telefone: cliente.telefone },
    });
    expect(codigosDepois).toBe(codigosAntes);

    // E a sessão serve para o que importa: ver e usar o pacote.
    const perfil = await httpOn
      .get('/conta/perfil')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    expect(perfil.body.pacotes).toHaveLength(1);

    const item = perfil.body.pacotes[0].itens.find((i: { status: string }) => i.status === 'DISPONIVEL');
    await httpOn
      .post('/conta/agendamentos')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        vendaId: perfil.body.pacotes[0].id,
        itemIds: [item.id],
        barbeiroId: ligada.barbeiroId,
        data: DIA,
        horaInicio: '17:00',
      })
      .expect(201);
  });

  it('★ a senha vai para o banco como HASH, nunca em texto', async () => {
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, nome: 'Cliente Com Pacote' },
    });
    expect(cliente.senhaHash).not.toContain(SENHA_CLIENTE);
    // Mesmo formato do login de staff: `sal:hash`, ambos hex.
    expect(cliente.senhaHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it('senha fraca é recusada, e a mensagem diz o porquê', async () => {
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, nome: 'Cliente Com Pacote' },
    });
    const res = await httpOn
      .post(`/clientes/${cliente.id}/senha`)
      .set('Authorization', `Bearer ${tokenOn}`)
      .send({ senha: '12345678' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('adivinhar');
  });

  it('★ telefone inexistente responde IGUAL a senha errada', async () => {
    const inexistente = await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone: novoFone(), senha: SENHA_CLIENTE });
    const cliente = await prisma.cliente.findFirstOrThrow({
      where: { companyId: ligada.companyId, nome: 'Cliente Com Pacote' },
    });
    const senhaErrada = await httpOn
      .post('/conta/login/senha')
      .send({ companyId: ligada.companyId, telefone: cliente.telefone, senha: 'nao-e-essa-1' });

    expect(inexistente.status).toBe(senhaErrada.status);
    expect(inexistente.body.message).toBe(senhaErrada.body.message);
  });
});
