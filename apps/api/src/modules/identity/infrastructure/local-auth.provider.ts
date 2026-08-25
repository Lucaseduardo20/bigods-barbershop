import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Papel } from '@bigods/contracts';
import { AuthProvider, UsuarioAutenticado } from '../domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { hashSenha, verificaSenha } from './senha';

const TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Reexportado porque os controllers já importam `hashSenha` daqui. O formato do
 * hash mora em `senha.ts`, sem Nest e sem Prisma, para que os SEEDS possam
 * gerar exatamente o mesmo hash que este provider valida — antes eles copiavam
 * a implementação, que é a mesma regra em dois lugares.
 */
export { hashSenha };

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
