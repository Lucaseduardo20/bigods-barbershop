import { Prisma, PrismaClient } from '@prisma/client';

/** Cliente Prisma raiz ou transacional — os repositórios aceitam ambos. */
export type Db = PrismaClient | Prisma.TransactionClient;
