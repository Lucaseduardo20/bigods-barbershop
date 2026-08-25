import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hashSenha } from '../modules/identity/infrastructure/senha';
import { slugDoNome, slugUnico } from '../modules/staff/domain/slug';

/**
 * SEED DE PRODUÇÃO — o mínimo indispensável para o sistema EXISTIR, e nada
 * além disso.
 *
 * ## Por que existe, separado do seed de desenvolvimento
 *
 * O seed de dev (`prisma/seed.ts`) cria Gabriel, Igor, serviços, produtos,
 * pacotes, disponibilidade de 30 dias — uma barbearia fictícia inteira, ótima
 * para desenvolver e catastrófica em produção: dados falsos misturados com
 * dados reais de cliente, indistinguíveis depois. Este arquivo é o oposto: cria
 * **um admin** e o registro da empresa que o admin precisa para existir.
 *
 * Tudo o mais — barbeiros, serviços, preços, produtos, pacotes, ofertas — é
 * cadastrado pela interface, pelo próprio dono. É o cadastro real da barbearia,
 * não um chute de quem escreveu o script.
 *
 * ## A `Company` não é "algo além do admin"
 *
 * O pedido foi "apenas o admin". Só que `Barbeiro.companyId` é chave
 * estrangeira: sem a linha da empresa, o admin não pode ser inserido. E o
 * sistema inteiro é multi-tenant por costura (CLAUDE.md §9) — sem tenant
 * explícito, operação nenhuma funciona. A `Company` aqui é a estrutura que
 * sustenta o admin, não um dado de exemplo. Ela nasce com os DEFAULTS do
 * schema, inclusive `comissaoProdutosBp = 0`: o sistema nunca paga comissão que
 * ninguém configurou.
 *
 * ## Idempotente, e o que isso significa exatamente
 *
 * Rodar duas vezes não duplica nem SOBRESCREVE. Se o login já existe, o script
 * não toca na linha — em particular, **não reseta a senha**. Isso é deliberado:
 * o procedimento manda trocar a senha inicial no primeiro acesso, e um seed que
 * "conserta" a senha a cada execução devolveria a senha fraca e temporária sem
 * ninguém perceber. Mesma coisa para a `Company`: se já existe, os parâmetros
 * que o dono ajustou (fuso, comissão de produto, janelas) ficam como estão.
 *
 * ## Senha
 *
 * Vem de `ADMIN_SEED_SENHA`, nunca do código — senha em repositório é senha
 * vazada, e esta some do histórico do shell mas nunca de um `git log`. O script
 * RECUSA rodar sem ela.
 */

/**
 * Mínimo de 4 caracteres. Não é política de força de senha: é o
 * `@MinLength(4)` do `LoginDto` em `auth.controller.ts`. Com menos que isso, a
 * validação da borda recusa o corpo ANTES de conferir o hash — o admin seria
 * criado e não conseguiria entrar nunca, com um 400 que não diz nada sobre
 * tamanho de senha. Falhar aqui, no seed, é o único lugar onde esse erro é
 * legível.
 */
export const SENHA_MINIMA = 4;

/** Abaixo disto o script avisa (mas roda) — ver o aviso no procedimento. */
const SENHA_CURTA = 10;

export interface OpcoesSeedProducao {
  companyId: string;
  companyNome: string;
  adminLogin: string;
  adminNome: string;
  senha: string;
}

export interface ResultadoSeedProducao {
  companyCriada: boolean;
  adminCriado: boolean;
  adminId: string;
  adminSlug: string;
}

/**
 * Lê e valida as opções do ambiente. Separada de `seedProducao` para que a
 * validação seja testável sem banco, e para que o teste possa semear numa
 * empresa isolada sem depender de variáveis de ambiente do processo.
 *
 * `ADMIN_SEED_LOGIN`/`ADMIN_SEED_NOME`/`COMPANY_ID` têm default e existem para
 * o teste conseguir criar um par isolado no mesmo banco. Em produção nada disso
 * é passado: os defaults SÃO o valor de produção.
 */
export function opcoesDoAmbiente(env: NodeJS.ProcessEnv = process.env): OpcoesSeedProducao {
  const senha = env.ADMIN_SEED_SENHA ?? '';
  if (!senha) {
    throw new Error(
      'ADMIN_SEED_SENHA não definida. A senha do admin nunca fica no código — ' +
        'passe na execução: ADMIN_SEED_SENHA="..." npm run seed:prod -w @bigods/api',
    );
  }
  if (senha.length < SENHA_MINIMA) {
    throw new Error(
      `ADMIN_SEED_SENHA tem ${senha.length} caractere(s); o login exige no mínimo ${SENHA_MINIMA} ` +
        '(@MinLength(4) do LoginDto). Com menos, o admin seria criado e não conseguiria entrar.',
    );
  }
  return {
    companyId: env.COMPANY_ID?.trim() || 'bigods',
    companyNome: env.COMPANY_NOME?.trim() || "Bigod's Barber",
    adminLogin: env.ADMIN_SEED_LOGIN?.trim() || 'lkt',
    adminNome: env.ADMIN_SEED_NOME?.trim() || 'LKT',
    senha,
  };
}

export async function seedProducao(
  prisma: PrismaClient,
  opcoes: OpcoesSeedProducao,
): Promise<ResultadoSeedProducao> {
  const empresa = await prisma.company.findUnique({ where: { id: opcoes.companyId } });
  const companyCriada = !empresa;
  if (!empresa) {
    // Só o id e o nome: todo o resto (fuso, janelas, comissão de produto em
    // ZERO, teto de desconto) fica nos defaults do schema, para o dono
    // configurar pela interface. Nenhum número de negócio é chutado aqui.
    await prisma.company.create({
      data: { id: opcoes.companyId, nome: opcoes.companyNome },
    });
  }

  const existente = await prisma.barbeiro.findUnique({ where: { login: opcoes.adminLogin } });
  if (existente) {
    // Idempotência de verdade: nada é atualizado. Ver o cabeçalho — reescrever
    // a senha aqui desfaria a troca obrigatória do primeiro acesso.
    return {
      companyCriada,
      adminCriado: false,
      adminId: existente.id,
      adminSlug: existente.slug,
    };
  }

  const slugsUsados = new Set(
    (
      await prisma.barbeiro.findMany({
        where: { companyId: opcoes.companyId },
        select: { slug: true },
      })
    ).map((b) => b.slug),
  );
  const slug = slugUnico(slugDoNome(opcoes.adminNome) || 'admin', slugsUsados);

  const admin = await prisma.barbeiro.create({
    data: {
      id: `bar-${randomUUID()}`,
      companyId: opcoes.companyId,
      nome: opcoes.adminNome,
      slug,
      // ADMIN sem BARBEIRO: é usuário de GESTÃO, não atende. Quem atende é
      // cadastrado depois, pela interface — inclusive o dono, se ele também
      // cortar cabelo (aí o cadastro dele acumula os dois papéis).
      papeis: ['ADMIN'],
      // Não atende, então não há comissão de serviço a configurar. Zero não é
      // "esqueci de preencher": é o valor correto para quem não realiza
      // atendimento.
      comissaoPadraoBp: 0,
      login: opcoes.adminLogin,
      senhaHash: hashSenha(opcoes.senha),
      ativo: true,
    },
  });

  return { companyCriada, adminCriado: true, adminId: admin.id, adminSlug: admin.slug };
}

/** Execução por linha de comando. Não roda quando o módulo é importado (teste). */
async function main(): Promise<void> {
  const opcoes = opcoesDoAmbiente();
  const prisma = new PrismaClient();
  try {
    console.log(`[seed:prod] empresa=${opcoes.companyId} admin=${opcoes.adminLogin}`);
    if (opcoes.senha.length < SENHA_CURTA) {
      console.warn(
        `[seed:prod] ⚠ a senha tem ${opcoes.senha.length} caracteres. É aceitável como senha ` +
          'TEMPORÁRIA de primeiro acesso — troque-a no painel antes de operar de verdade.',
      );
    }

    const r = await seedProducao(prisma, opcoes);

    console.log(
      r.companyCriada
        ? `[seed:prod] empresa "${opcoes.companyNome}" criada.`
        : '[seed:prod] empresa já existia — nada alterado nela.',
    );
    if (r.adminCriado) {
      console.log(`[seed:prod] admin "${opcoes.adminLogin}" criado (id=${r.adminId}).`);
      console.log('[seed:prod] ✓ próximo passo OBRIGATÓRIO: entrar no painel e TROCAR A SENHA.');
    } else {
      console.log(
        `[seed:prod] admin "${opcoes.adminLogin}" já existe (id=${r.adminId}) — ` +
          'nada alterado, inclusive a senha.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`[seed:prod] ✗ ${erro instanceof Error ? erro.message : erro}`);
    process.exit(1);
  });
}
