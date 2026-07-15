import { Injectable } from '@nestjs/common';
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
 * Provider de identidade demo — funciona 100% sem AWS. Gera um código OTP de 6
 * dígitos, guardado com hash numa tabela própria, expira em poucos minutos.
 * NUNCA envia SMS real; só devolve o código na resposta da API quando
 * `DEMO_MODE=true`. É o default em desenvolvimento.
 *
 * O "user pool" demo é a tabela `DemoIdentidade` (equivalente local do Cognito
 * User Pool). Trocar para Cognito é `IDENTITY_PROVIDER=cognito` — nada acima
 * deste arquivo muda.
 */
@Injectable()
export class DemoIdentityProvider implements IdentityProvider {
  private readonly secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me';
  private readonly demoMode = process.env.DEMO_MODE === 'true';
  private readonly ttlMinutos = Number(process.env.DEMO_OTP_TTL_MINUTOS ?? '5') || 5;

  constructor(private readonly prisma: PrismaService) {}

  async provisionarUsuario(input: ProvisionarUsuarioInput): Promise<void> {
    // Idempotente: um usuário demo por (empresa, telefone). O `sub` é estável.
    await this.prisma.demoIdentidade.upsert({
      where: { companyId_telefone: { companyId: input.companyId, telefone: input.telefoneE164 } },
      create: {
        companyId: input.companyId,
        telefone: input.telefoneE164,
        sub: `demo-${randomUUID()}`,
      },
      update: {},
    });
  }

  async iniciarLogin(input: IniciarLoginInput): Promise<DesafioLogin> {
    const expiraEm = new Date(Date.now() + this.ttlMinutos * 60_000);

    const identidade = await this.prisma.demoIdentidade.findUnique({
      where: { companyId_telefone: { companyId: input.companyId, telefone: input.telefoneE164 } },
    });
    // Telefone não provisionado (não comprou pacote): resposta NEUTRA, sem código,
    // sem "SMS" — indistinguível de um telefone válido para não revelar quem é cliente.
    if (!identidade) {
      return { desafio: '', expiraEm, codigoDemo: null };
    }

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const desafio = await this.prisma.demoDesafioLogin.create({
      data: {
        companyId: input.companyId,
        telefone: input.telefoneE164,
        codigoHash: this.hash(input.companyId, input.telefoneE164, codigo),
        expiraEm,
      },
    });

    // Em produção isto seria um envio de SMS. Aqui, nada é enviado; o código só
    // volta na resposta quando DEMO_MODE=true.
    return { desafio: desafio.id, expiraEm, codigoDemo: this.demoMode ? codigo : null };
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

    // Consome o desafio (uso único) e devolve o sub estável do usuário demo.
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

  private hash(companyId: string, telefone: string, codigo: string): string {
    return createHmac('sha256', this.secret).update(`${companyId}:${telefone}:${codigo}`).digest('hex');
  }

  private comparaHash(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
