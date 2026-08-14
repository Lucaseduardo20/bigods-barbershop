import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgresql://bigods:bigods@localhost:5432/bigods';

// eslint-disable-next-line import/first
import { PrismaService } from '../../src/shared/infrastructure/prisma.service';
// eslint-disable-next-line import/first
import { WhatsAppIdentityProvider } from '../../src/modules/identity/infrastructure/whatsapp-identity.provider';
// eslint-disable-next-line import/first
import {
  TelefoneSemWhatsAppError,
  WhatsAppOtpClient,
} from '../../src/modules/identity/infrastructure/whatsapp-otp.client';

/**
 * `WhatsAppIdentityProvider` direto (sem subir o Nest app inteiro nem HTTP) —
 * mesma lógica de OTP do provider demo (`OtpIdentityProviderBase`), só que
 * exercitada aqui pela subclasse WhatsApp, com o CLIENTE do serviço whatsapp-otp
 * mockado em memória (`FakeWhatsAppOtpClient`, nenhum teste toca WhatsApp
 * real). Bypassa a borda HTTP de propósito: os endpoints `/conta/login/*`
 * são limitados por telefone a 5 requisições/10min (`TelefoneOuIpThrottlerGuard`),
 * o que tornaria inviável testar aqui o rate limit PRÓPRIO do desafio (5
 * tentativas erradas por código) sem estourar o throttle da borda antes. A
 * cobertura de fiação ponta a ponta (factory → provider → cliente HTTP → API)
 * fica em `whatsapp-otp-boot.e2e.spec.ts`.
 */

const companyId = `co-whatsapp-otp-${randomUUID()}`;
const sufixo = String(Date.now()).slice(-6);
const telefone = (prefixo: string) => `+55119${prefixo}${sufixo}`;

let prisma: PrismaService;

class FakeWhatsAppOtpClient implements WhatsAppOtpClient {
  enviados: { telefoneE164: string; mensagem: string }[] = [];
  falharProximoEnvio = false;
  proximoNumeroSemWhatsApp = false;

  async enviar(telefoneE164: string, mensagem: string): Promise<void> {
    if (this.proximoNumeroSemWhatsApp) {
      this.proximoNumeroSemWhatsApp = false;
      throw new TelefoneSemWhatsAppError('Número não encontrado no WhatsApp');
    }
    if (this.falharProximoEnvio) {
      this.falharProximoEnvio = false;
      throw new Error('serviço whatsapp-otp fora do ar (simulado)');
    }
    this.enviados.push({ telefoneE164, mensagem });
  }

  ultimoCodigo(): string {
    const ultima = this.enviados[this.enviados.length - 1];
    const codigo = ultima?.mensagem.match(/\d{6}/)?.[0];
    if (!codigo) throw new Error('nenhum código capturado no client fake');
    return codigo;
  }
}

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.demoDesafioLogin.deleteMany({ where: { companyId } });
  await prisma.demoIdentidade.deleteMany({ where: { companyId } });
  await prisma.$disconnect();
});

describe('WhatsAppIdentityProvider (cliente whatsapp-otp mockado)', () => {
  it('provisiona, "envia" o código pelo client mockado (nunca na resposta) e confirma com sucesso', async () => {
    const client = new FakeWhatsAppOtpClient();
    const provider = new WhatsAppIdentityProvider(prisma, client, 5);
    const tel = telefone('01');

    await provider.provisionarUsuario({ companyId, telefoneE164: tel });
    const desafio = await provider.iniciarLogin({ companyId, telefoneE164: tel });
    expect(desafio.desafio).toBeTruthy();
    expect(desafio.codigoDemo).toBeNull(); // WhatsApp real NUNCA devolve o código na resposta

    expect(client.enviados).toHaveLength(1);
    expect(client.enviados[0]!.telefoneE164).toBe(tel);
    expect(client.enviados[0]!.mensagem).toMatch(/\d{6}/);

    const codigo = client.ultimoCodigo();
    const r = await provider.confirmarLogin({ companyId, telefoneE164: tel, codigo, desafio: desafio.desafio });
    expect(r?.sub).toMatch(/^whatsapp-/);
  });

  it('telefone NUNCA provisionado recebe o código do mesmo jeito (não existe gate de envio)', async () => {
    // Este teste já afirmou o contrário: telefone sem identidade externa
    // recebia desafio vazio e nada era enviado. Esse gate quebrava o cliente de
    // primeira viagem no agendamento e na compra — quem ainda não tem `sub` é
    // justamente quem precisa do código pra criar a primeira prova de posse.
    // A resposta deixou de ser neutra de propósito: "ter conta" não é mais
    // informação sensível (ver `identity-provider.ts`).
    const client = new FakeWhatsAppOtpClient();
    const provider = new WhatsAppIdentityProvider(prisma, client, 5);
    const tel = telefone('02');

    const desafio = await provider.iniciarLogin({ companyId, telefoneE164: tel });

    expect(desafio.desafio).toBeTruthy();
    expect(desafio.codigoDemo).toBeNull(); // WhatsApp real nunca devolve o código
    expect(client.enviados).toHaveLength(1);
    expect(client.enviados[0]!.telefoneE164).toBe(tel);

    // E o código enviado é utilizável: o provisionamento aconteceu na hora,
    // então a confirmação encontra a identidade e devolve o `sub`.
    const r = await provider.confirmarLogin({
      companyId,
      telefoneE164: tel,
      codigo: client.ultimoCodigo(),
      desafio: desafio.desafio,
    });
    expect(r?.sub).toMatch(/^whatsapp-/);
  });

  it('código ERRADO falha; o mesmo código CERTO não funciona duas vezes (uso único)', async () => {
    const client = new FakeWhatsAppOtpClient();
    const provider = new WhatsAppIdentityProvider(prisma, client, 5);
    const tel = telefone('03');
    await provider.provisionarUsuario({ companyId, telefoneE164: tel });
    const desafio = await provider.iniciarLogin({ companyId, telefoneE164: tel });

    expect(
      await provider.confirmarLogin({ companyId, telefoneE164: tel, codigo: '000000', desafio: desafio.desafio }),
    ).toBeNull();

    const codigo = client.ultimoCodigo();
    expect(
      await provider.confirmarLogin({ companyId, telefoneE164: tel, codigo, desafio: desafio.desafio }),
    ).not.toBeNull();
    expect(
      await provider.confirmarLogin({ companyId, telefoneE164: tel, codigo, desafio: desafio.desafio }),
    ).toBeNull();
  });

  it('código EXPIRADO falha', async () => {
    const client = new FakeWhatsAppOtpClient();
    const provider = new WhatsAppIdentityProvider(prisma, client, 5);
    const tel = telefone('04');
    await provider.provisionarUsuario({ companyId, telefoneE164: tel });
    const desafio = await provider.iniciarLogin({ companyId, telefoneE164: tel });
    await prisma.demoDesafioLogin.update({
      where: { id: desafio.desafio },
      data: { expiraEm: new Date(Date.now() - 1000) },
    });
    const codigo = client.ultimoCodigo();
    expect(
      await provider.confirmarLogin({ companyId, telefoneE164: tel, codigo, desafio: desafio.desafio }),
    ).toBeNull();
  });

  it('rate limit: 5 tentativas erradas esgotam o desafio — a 6ª falha mesmo com o código certo', async () => {
    const client = new FakeWhatsAppOtpClient();
    const provider = new WhatsAppIdentityProvider(prisma, client, 5);
    const tel = telefone('05');
    await provider.provisionarUsuario({ companyId, telefoneE164: tel });
    const desafio = await provider.iniciarLogin({ companyId, telefoneE164: tel });
    const codigo = client.ultimoCodigo();

    for (let i = 0; i < 5; i++) {
      expect(
        await provider.confirmarLogin({ companyId, telefoneE164: tel, codigo: '000000', desafio: desafio.desafio }),
      ).toBeNull();
    }
    expect(
      await provider.confirmarLogin({ companyId, telefoneE164: tel, codigo, desafio: desafio.desafio }),
    ).toBeNull();
  });

  it('falha no envio (serviço whatsapp-otp fora): erro limpo, NENHUM desafio órfão persistido, provider segue funcionando depois', async () => {
    const client = new FakeWhatsAppOtpClient();
    client.falharProximoEnvio = true;
    const provider = new WhatsAppIdentityProvider(prisma, client, 5);
    const tel = telefone('06');
    await provider.provisionarUsuario({ companyId, telefoneE164: tel });

    await expect(provider.iniciarLogin({ companyId, telefoneE164: tel })).rejects.toThrow();

    const desafiosOrfaos = await prisma.demoDesafioLogin.count({ where: { companyId, telefone: tel } });
    expect(desafiosOrfaos).toBe(0);

    // depois da falha, o provider continua operando normalmente — nada "quebrou" por dentro.
    const desafio = await provider.iniciarLogin({ companyId, telefoneE164: tel });
    expect(desafio.desafio).toBeTruthy();
  });

  it('número SEM WhatsApp: 400 pedindo pra conferir o número, não 503 "tente de novo"', async () => {
    // A distinção existe porque as duas situações pedem ações opostas do
    // cliente: serviço fora → insistir resolve; número sem WhatsApp → insistir
    // nunca resolve, só queima o rate limit dele. Antes o Baileys aceitava o
    // envio para um JID inexistente sem erro nenhum e o código sumia no ar.
    const client = new FakeWhatsAppOtpClient();
    client.proximoNumeroSemWhatsApp = true;
    const provider = new WhatsAppIdentityProvider(prisma, client, 5);
    const tel = telefone('07');
    await provider.provisionarUsuario({ companyId, telefoneE164: tel });

    await expect(provider.iniciarLogin({ companyId, telefoneE164: tel })).rejects.toMatchObject({
      status: 400,
    });

    // Mesma garantia do caso de indisponibilidade: nada de desafio órfão.
    const desafiosOrfaos = await prisma.demoDesafioLogin.count({ where: { companyId, telefone: tel } });
    expect(desafiosOrfaos).toBe(0);
  });
});
