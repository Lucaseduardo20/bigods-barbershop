import { Injectable } from '@nestjs/common';
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { Papel } from '@bigods/contracts';
import { AuthProvider, UsuarioAutenticado } from '../domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';

const TTL_MS = 12 * 60 * 60 * 1000;

export function hashSenha(senha: string): string {
  const sal = randomBytes(16).toString('hex');
  return `${sal}:${scryptSync(senha, sal, 32).toString('hex')}`;
}

function verificaSenha(senha: string, hash: string): boolean {
  const [sal, esperado] = hash.split(':');
  if (!sal || !esperado) return false;
  const calculado = scryptSync(senha, sal, 32);
  return timingSafeEqual(calculado, Buffer.from(esperado, 'hex'));
}

@Injectable()
export class LocalAuthProvider implements AuthProvider {
  private readonly secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

  constructor(private readonly prisma: PrismaService) {}

  async validarCredenciais(login: string, senha: string): Promise<UsuarioAutenticado | null> {
    const barbeiro = await this.prisma.barbeiro.findUnique({ where: { login } });
    if (!barbeiro || !barbeiro.senhaHash || !barbeiro.ativo) return null;
    if (!verificaSenha(senha, barbeiro.senhaHash)) return null;
    return {
      barbeiroId: barbeiro.id,
      companyId: barbeiro.companyId,
      nome: barbeiro.nome,
      papeis: barbeiro.papeis.map((p) => Papel[p]),
    };
  }

  emitirToken(usuario: UsuarioAutenticado): string {
    const payload = Buffer.from(
      JSON.stringify({ ...usuario, exp: Date.now() + TTL_MS }),
    ).toString('base64url');
    return `${payload}.${this.assinar(payload)}`;
  }

  verificarToken(token: string): UsuarioAutenticado | null {
    const [payload, assinatura] = token.split('.');
    if (!payload || !assinatura) return null;
    const esperada = this.assinar(payload);
    const a = Buffer.from(assinatura);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (typeof dados.exp !== 'number' || dados.exp < Date.now()) return null;
      return {
        barbeiroId: dados.barbeiroId,
        companyId: dados.companyId,
        nome: dados.nome,
        papeis: dados.papeis,
      };
    } catch {
      return null;
    }
  }

  private assinar(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
