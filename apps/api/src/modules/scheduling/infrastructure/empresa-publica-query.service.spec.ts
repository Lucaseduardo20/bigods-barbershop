import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmpresaPublicaQueryService } from './empresa-publica-query.service';
import type { CobrancaOnlineService } from '../../payments/application/cobranca-online.service';
import type { PrismaService } from '../../../shared/infrastructure/prisma.service';

const ACCESS_TOKEN = 'APP_USR-1111111111111111-000000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-000000001';
const PUBLIC_KEY = 'APP_USR-2222222222222222-000000-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-000000001';

function prismaFalso(): PrismaService {
  return {
    company: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'bigods',
        nome: "Bigod's Barber",
        timezone: 'America/Sao_Paulo',
        descontoTetoCentavos: 3000,
      }),
    },
    degrauDeDesconto: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

function cobrancaFalsa(meios: ('PIX' | 'CARTAO_CREDITO')[]): CobrancaOnlineService {
  return { meiosDisponiveis: meios } as unknown as CobrancaOnlineService;
}

const ENV_ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.MERCADOPAGO_ACCESS_TOKEN = ACCESS_TOKEN;
  process.env.MERCADOPAGO_PUBLIC_KEY = PUBLIC_KEY;
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAL };
});

describe('EmpresaPublicaQueryService', () => {
  it('empresa inexistente é 404, nunca fallback (DOMAIN.md §2.4)', async () => {
    const prisma = {
      company: { findUnique: vi.fn().mockResolvedValue(null) },
      degrauDeDesconto: { findMany: vi.fn() },
    } as unknown as PrismaService;
    const s = new EmpresaPublicaQueryService(prisma, cobrancaFalsa(['PIX']), { ativo: false });
    await expect(s.empresa('nao-existe')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('anuncia os meios que o serviço de cobrança reporta', async () => {
    const s = new EmpresaPublicaQueryService(prismaFalso(),
      cobrancaFalsa(['PIX', 'CARTAO_CREDITO']), { ativo: false });
    const r = await s.empresa('bigods');
    expect(r.pagamentoOnline.meios).toEqual(['PIX', 'CARTAO_CREDITO']);
  });

  it('com cartão anunciado, devolve a chave PÚBLICA', async () => {
    const s = new EmpresaPublicaQueryService(prismaFalso(),
      cobrancaFalsa(['PIX', 'CARTAO_CREDITO']), { ativo: false });
    const r = await s.empresa('bigods');
    expect(r.pagamentoOnline.mercadoPagoPublicKey).toBe(PUBLIC_KEY);
  });

  it('sem cartão anunciado, não devolve chave nenhuma', async () => {
    const s = new EmpresaPublicaQueryService(prismaFalso(), cobrancaFalsa(['PIX']), { ativo: false });
    const r = await s.empresa('bigods');
    expect(r.pagamentoOnline.mercadoPagoPublicKey).toBeNull();
  });

  it('modo manual (nenhum meio) também não devolve chave', async () => {
    const s = new EmpresaPublicaQueryService(prismaFalso(), cobrancaFalsa([]), { ativo: false });
    const r = await s.empresa('bigods');
    expect(r.pagamentoOnline.meios).toEqual([]);
    expect(r.pagamentoOnline.mercadoPagoPublicKey).toBeNull();
  });

  it('★ chave não configurada vira null, NUNCA string vazia', async () => {
    // `''` passaria por `if (publicKey)` só às vezes e por `!== null` sempre — o
    // funil trataria "não configurado" como "configurado" e o cliente veria o
    // formulário de cartão travar na tokenização, depois de digitar tudo.
    delete process.env.MERCADOPAGO_PUBLIC_KEY;
    const s = new EmpresaPublicaQueryService(prismaFalso(),
      cobrancaFalsa(['PIX', 'CARTAO_CREDITO']), { ativo: false });
    const r = await s.empresa('bigods');
    expect(r.pagamentoOnline.mercadoPagoPublicKey).toBeNull();
  });

  it('★★ CADEADO: o Access Token NUNCA aparece na resposta pública', async () => {
    // Esta rota é servida sem autenticação para qualquer visitante do funil, e o
    // Access Token tem o MESMO prefixo `APP_USR-` da chave pública — trocar um pelo
    // outro é um erro invisível em revisão de código, e publicaria a credencial de
    // servidor em toda visita.
    //
    // Varre a resposta INTEIRA serializada, não só o campo esperado: um campo novo
    // adicionado depois (`debug`, `config`, `mp`) também é pego aqui.
    const s = new EmpresaPublicaQueryService(prismaFalso(),
      cobrancaFalsa(['PIX', 'CARTAO_CREDITO']), { ativo: false });
    const serializada = JSON.stringify(await s.empresa('bigods'));
    expect(serializada).not.toContain(ACCESS_TOKEN);
    expect(serializada).toContain(PUBLIC_KEY);
  });

  it('★★ CADEADO: nenhum segredo de gateway vaza, mesmo com todas as envs setadas', async () => {
    // Webhook secret é o pior deles: com ele, qualquer pessoa forja uma notificação
    // assinada e confirma pagamento que nunca aconteceu.
    process.env.MERCADOPAGO_WEBHOOK_SECRET = 'segredo-do-webhook-xyz';
    process.env.MERCADOPAGO_CLIENT_SECRET = 'client-secret-abc';
    process.env.ABACATEPAY_API_KEY = 'abc_dev_chave';
    process.env.ABACATEPAY_WEBHOOK_SECRET = 'segredo-abacate';
    const s = new EmpresaPublicaQueryService(prismaFalso(),
      cobrancaFalsa(['PIX', 'CARTAO_CREDITO']), { ativo: false });
    const serializada = JSON.stringify(await s.empresa('bigods'));
    for (const segredo of [
      'segredo-do-webhook-xyz',
      'client-secret-abc',
      'abc_dev_chave',
      'segredo-abacate',
    ]) {
      expect(serializada, `vazou ${segredo}`).not.toContain(segredo);
    }
  });

  it('segue devolvendo o resto do DTO (fuso, desconto, modo demo)', async () => {
    const prisma = prismaFalso();
    (prisma.degrauDeDesconto.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { posicao: 2, valorCentavos: 500 },
    ]);
    const s = new EmpresaPublicaQueryService(prisma, cobrancaFalsa(['PIX']), { ativo: false });
    const r = await s.empresa('bigods');
    expect(r.timezone).toBe('America/Sao_Paulo');
    expect(r.descontoProgressivo).toEqual({
      degraus: [{ posicao: 2, valorCentavos: 500 }],
      tetoCentavos: 3000,
    });
  });
});
