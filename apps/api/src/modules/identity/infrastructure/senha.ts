import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Hash e conferência de senha do login de STAFF.
 *
 * Vive num módulo próprio, sem `@nestjs/*` e sem Prisma, por um motivo prático:
 * além do `LocalAuthProvider`, quem precisa gerar hash nesse formato são os
 * SEEDS — scripts standalone, sem container de DI. Enquanto a função morava
 * dentro do provider (uma classe `@Injectable` que injeta `PrismaService`), o
 * seed de desenvolvimento resolveu copiando as três linhas. Duas implementações
 * do MESMO formato de hash é a definição do anti-padrão: no dia em que o
 * parâmetro do scrypt mudar de um lado, o seed passa a gravar um hash que o
 * login não valida — e o sintoma é "a senha certa não entra", que ninguém liga
 * a uma mudança de seed.
 *
 * Formato: `sal:hash`, ambos hex. Sal aleatório de 16 bytes por senha, scrypt
 * com os parâmetros padrão do Node e 32 bytes de saída.
 *
 * NÃO é `domain/`: o formato do hash é decisão de armazenamento, não regra de
 * negócio. O domínio não sabe que existe senha.
 */

const BYTES_DE_SAL = 16;
const BYTES_DE_HASH = 32;

export function hashSenha(senha: string): string {
  const sal = randomBytes(BYTES_DE_SAL).toString('hex');
  return `${sal}:${scryptSync(senha, sal, BYTES_DE_HASH).toString('hex')}`;
}

export function verificaSenha(senha: string, hash: string): boolean {
  const [sal, esperado] = hash.split(':');
  if (!sal || !esperado) return false;
  const calculado = scryptSync(senha, sal, BYTES_DE_HASH);
  // Comparação em tempo constante: comparar com `===` vaza, pelo tempo de
  // resposta, quantos bytes iniciais bateram.
  return timingSafeEqual(calculado, Buffer.from(esperado, 'hex'));
}
