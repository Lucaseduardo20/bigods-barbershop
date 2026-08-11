import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import {
  ConfirmarLoginInput,
  DesafioLogin,
  IdentityProvider,
  IniciarLoginInput,
  ProvisionarUsuarioInput,
  ResultadoConfirmacao,
} from '../domain/identity-provider';

/** Máximo de tentativas de código por desafio (defesa sob o rate limit HTTP). */
const MAX_TENTATIVAS_POR_DESAFIO = 5;

/**
 * Lógica de OTP compartilhada entre providers que guardam o próprio desafio —
 * código de 6 dígitos com hash, expiração, uso único, rate limit de tentativas
 * (tabelas `DemoIdentidade`/`DemoDesafioLogin`, mesmas do provider original;
 * o nome ficou de quando só o modo demo existia, mas a lógica sempre foi
 * genérica o bastante para qualquer canal de envio real). Hoje usada por
 * `DemoIdentityProvider` e `WhatsAppIdentityProvider` — **nunca** por
 * `CognitoIdentityProvider`, que delega o desafio inteiro pro lado da AWS.
 *
 * Subclasses só decidem COMO o código chega ao cliente (`enviarCodigo`) e o
 * que volta no campo de depuração `codigoDemo` (`codigoNaResposta`) — nunca
 * reescrevem geração, hash, expiração, uso único ou rate limit.
 */
export abstract class OtpIdentityProviderBase implements IdentityProvider {
  protected readonly secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

  constructor(
    protected readonly prisma: PrismaService,
    private readonly ttlMinutos: number,
    private readonly subPrefix: string,
  ) {}

  async provisionarUsuario(input: ProvisionarUsuarioInput): Promise<void> {
    // Idempotente: um usuário externo por (empresa, telefone). O `sub` é estável.
    await this.prisma.demoIdentidade.upsert({
      where: { companyId_telefone: { companyId: input.companyId, telefone: input.telefoneE164 } },
      create: {
        companyId: input.companyId,
        telefone: input.telefoneE164,
        sub: `${this.subPrefix}-${randomUUID()}`,
      },
      update: {},
    });
  }

  async iniciarLogin(input: IniciarLoginInput): Promise<DesafioLogin> {
    const expiraEm = new Date(Date.now() + this.ttlMinutos * 60_000);

    const identidade = await this.prisma.demoIdentidade.findUnique({
      where: { companyId_telefone: { companyId: input.companyId, telefone: input.telefoneE164 } },
    });
    // Telefone não provisionado: resposta NEUTRA, sem código — indistinguível
    // de um telefone válido para não revelar quem é cliente.
    if (!identidade) {
      return { desafio: '', expiraEm, codigoDemo: null };
    }

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // Envia (ou não, no demo) ANTES de persistir o desafio: se o envio falhar,
    // nada fica gravado — nunca existe um desafio "órfão" que o cliente não
    // tem como responder porque o código nunca chegou a ele.
    await this.enviarCodigo(input.telefoneE164, codigo, this.ttlMinutos);

    const desafio = await this.prisma.demoDesafioLogin.create({
      data: {
        companyId: input.companyId,
        telefone: input.telefoneE164,
        codigoHash: this.hash(input.companyId, input.telefoneE164, codigo),
        expiraEm,
      },
    });

    return { desafio: desafio.id, expiraEm, codigoDemo: this.codigoNaResposta(codigo) };
  }

  async confirmarLogin(input: ConfirmarLoginInput): Promise<ResultadoConfirmacao | null> {
    if (!input.desafio) return null;

    const desafio = await this.prisma.demoDesafioLogin.findFirst({
      where: { id: input.desafio, companyId: input.companyId, telefone: input.telefoneE164 },
    });
    if (!desafio) return null;
    if (desafio.consumidoEm) return null;
    if (desafio.expiraEm.getTime() < Date.now()) return null;
    if (desafio.tentativas >= MAX_TENTATIVAS_POR_DESAFIO) return null;

    const esperado = this.hash(input.companyId, input.telefoneE164, input.codigo);
    const confere = this.comparaHash(esperado, desafio.codigoHash);

    if (!confere) {
      await this.prisma.demoDesafioLogin.update({
        where: { id: desafio.id },
        data: { tentativas: { increment: 1 } },
      });
      return null;
    }

    // Consome o desafio (uso único) e devolve o sub estável do usuário.
    await this.prisma.demoDesafioLogin.update({
      where: { id: desafio.id },
      data: { consumidoEm: new Date(), tentativas: { increment: 1 } },
    });
    const identidade = await this.prisma.demoIdentidade.findUnique({
      where: { companyId_telefone: { companyId: input.companyId, telefone: input.telefoneE164 } },
    });
    if (!identidade) return null;
    return { sub: identidade.sub };
  }

  /**
   * Como o código chega ao cliente. Demo: não envia nada (só devolve na
   * resposta com DEMO_MODE=true). WhatsApp: HTTP pro serviço whatsapp-otp (Baileys) — deve
   * lançar um erro claro (nunca deixar a exceção crua vazar) se o envio
   * falhar, para que `iniciarLogin` nunca persista um desafio órfão.
   */
  protected abstract enviarCodigo(telefoneE164: string, codigo: string, ttlMinutos: number): Promise<void>;

  /** O que volta no campo de depuração `codigoDemo`. Só o provider demo, com DEMO_MODE=true, devolve algo — todo o resto é sempre `null`. */
  protected abstract codigoNaResposta(codigo: string): string | null;

  private hash(companyId: string, telefone: string, codigo: string): string {
    return createHmac('sha256', this.secret).update(`${companyId}:${telefone}:${codigo}`).digest('hex');
  }

  private comparaHash(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
