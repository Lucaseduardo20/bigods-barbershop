import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CobrancaOnlineService } from './cobranca-online.service';
import { IntencaoDePagamento } from '../domain/intencao-de-pagamento.aggregate';
import type { PaymentGateway } from '../domain/payment-gateway';
import type { ConfigPagamentoManual } from '../../../shared/config/pagamento-manual';
import type { UnitOfWork } from '../../../shared/application/unit-of-work';
import { Dinheiro } from '../../../shared/domain/dinheiro';

const EXPIRA = new Date('2026-08-27T12:30:00.000Z');

function intencao(): IntencaoDePagamento {
  return IntencaoDePagamento.criar({
    id: 'int-1',
    companyId: 'co-1',
    referencia: { tipo: 'ATENDIMENTO', atendimentoId: 'at-1' },
    valor: Dinheiro.deCentavos(8500),
    externalId: 'ext-1',
    expiraEm: EXPIRA,
  });
}

/** Gateway falso, com o suporte a cartão sob controle do teste. */
function gatewayFalso(suportaCartao: boolean) {
  return {
    provedor: suportaCartao ? ('MERCADOPAGO' as const) : ('ABACATEPAY' as const),
    suportaCartao,
    expiraEmSegundos: 1800,
    criarCobrancaPix: vi.fn().mockResolvedValue({
      gatewayId: 'ORD-1',
      qrCode: 'data:image/png;base64,AAA',
      copiaECola: '00020126...',
    }),
    consultarCobranca: vi.fn(),
    estornar: vi.fn(),
    pagarComCartao: vi.fn(),
  } as unknown as PaymentGateway & { criarCobrancaPix: ReturnType<typeof vi.fn> };
}

function uowFalso(): UnitOfWork {
  return {
    transacao: vi.fn(async (fn: (repos: unknown) => Promise<unknown>) =>
      fn({ intencoesDePagamento: { porId: vi.fn().mockResolvedValue(null), salvar: vi.fn() } }),
    ),
  } as unknown as UnitOfWork;
}

const MANUAL_DESLIGADO: ConfigPagamentoManual = { ativo: false, whatsappNumero: '' };
const MANUAL_LIGADO: ConfigPagamentoManual = { ativo: true, whatsappNumero: '5511999999999' };

const comanda = {
  titulo: 'Agendamento',
  clienteNome: 'Rafael',
  clienteTelefone: '+5511999999999',
  itens: [{ descricao: 'Corte', valorCentavos: 8500 }],
  totalCentavos: 8500,
};

describe('CobrancaOnlineService — meios disponíveis', () => {
  it('gateway com cartão anuncia PIX e cartão', () => {
    const s = new CobrancaOnlineService(gatewayFalso(true), MANUAL_DESLIGADO, uowFalso());
    expect(s.meiosDisponiveis).toEqual(['PIX', 'CARTAO_CREDITO']);
  });

  it('gateway sem cartão anuncia só PIX', () => {
    const s = new CobrancaOnlineService(gatewayFalso(false), MANUAL_DESLIGADO, uowFalso());
    expect(s.meiosDisponiveis).toEqual(['PIX']);
  });

  it('★ modo manual (WhatsApp) não anuncia NENHUM meio', () => {
    // Lista vazia é o sinal de "vai pelo WhatsApp" para o funil. Anunciar PIX ali
    // faria o funil prometer QR e a tela seguinte entregar outra coisa.
    const s = new CobrancaOnlineService(gatewayFalso(true), MANUAL_LIGADO, uowFalso());
    expect(s.meiosDisponiveis).toEqual([]);
  });

  it('★ a capacidade vem do ADAPTER, não de um if sobre o nome do gateway', () => {
    // Se alguém trocar isto por `provedor === 'MERCADOPAGO'`, este teste continua
    // passando — mas um adapter novo que cobre cartão passaria a ser invisível.
    // O que o teste fixa é o contrato: quem responde é `suportaCartao`.
    const gw = gatewayFalso(false);
    Object.defineProperty(gw, 'provedor', { value: 'MERCADOPAGO' });
    const s = new CobrancaOnlineService(gw, MANUAL_DESLIGADO, uowFalso());
    expect(s.meiosDisponiveis).toEqual(['PIX']);
  });
});

describe('CobrancaOnlineService — assertMeioSuportado', () => {
  it('meio ausente nunca falha (ausente = PIX, o trilho base)', () => {
    const s = new CobrancaOnlineService(gatewayFalso(false), MANUAL_DESLIGADO, uowFalso());
    expect(() => s.assertMeioSuportado(undefined)).not.toThrow();
  });

  it('recusa cartão em gateway que não cobra cartão, com 400', () => {
    const s = new CobrancaOnlineService(gatewayFalso(false), MANUAL_DESLIGADO, uowFalso());
    expect(() => s.assertMeioSuportado('CARTAO_CREDITO')).toThrow(BadRequestException);
  });

  it('aceita cartão quando o gateway cobra cartão', () => {
    const s = new CobrancaOnlineService(gatewayFalso(true), MANUAL_DESLIGADO, uowFalso());
    expect(() => s.assertMeioSuportado('CARTAO_CREDITO')).not.toThrow();
  });

  it('★ no modo manual recusa até PIX explícito — nenhum meio está disponível ali', () => {
    const s = new CobrancaOnlineService(gatewayFalso(true), MANUAL_LIGADO, uowFalso());
    expect(() => s.assertMeioSuportado('PIX')).toThrow(BadRequestException);
    expect(() => s.assertMeioSuportado('CARTAO_CREDITO')).toThrow(BadRequestException);
    // ...mas ausente segue passando: é o que os chamadores antigos mandam, e o
    // modo manual é decidido dentro de `gerar`, não recusando a compra.
    expect(() => s.assertMeioSuportado(undefined)).not.toThrow();
  });

  it('mensagem não vaza nome de gateway nem env var', () => {
    const s = new CobrancaOnlineService(gatewayFalso(false), MANUAL_DESLIGADO, uowFalso());
    try {
      s.assertMeioSuportado('CARTAO_CREDITO');
      expect.unreachable();
    } catch (e) {
      const msg = (e as BadRequestException).message.toLowerCase();
      expect(msg).not.toContain('abacatepay');
      expect(msg).not.toContain('mercadopago');
      expect(msg).not.toContain('payment_gateway');
    }
  });
});

describe('CobrancaOnlineService — gerar', () => {
  it('PIX (default) chama o gateway e devolve cobrança', async () => {
    const gw = gatewayFalso(true);
    const s = new CobrancaOnlineService(gw, MANUAL_DESLIGADO, uowFalso());
    const r = await s.gerar({ intencao: intencao(), descricao: 'x', comanda });
    expect(gw.criarCobrancaPix).toHaveBeenCalledOnce();
    expect(r.cobranca?.copiaECola).toBe('00020126...');
    expect(r.checkoutCartao).toBeNull();
    expect(r.pagamentoManual).toBeNull();
  });

  it('meio PIX explícito é idêntico ao default', async () => {
    const gw = gatewayFalso(true);
    const s = new CobrancaOnlineService(gw, MANUAL_DESLIGADO, uowFalso());
    const r = await s.gerar({ intencao: intencao(), descricao: 'x', comanda, meio: 'PIX' });
    expect(gw.criarCobrancaPix).toHaveBeenCalledOnce();
    expect(r.cobranca).not.toBeNull();
  });

  it('★ CARTÃO não chama o gateway — nenhuma order nasce aqui', async () => {
    // É o ponto todo do trilho: uma order de PIX e uma de cartão vivas para a
    // mesma intenção seriam DOIS caminhos de pagamento abertos, e a trava de "uma
    // tentativa viva por vez" só olha tentativas de cartão. O cliente poderia
    // pagar o PIX e ter o cartão aprovado.
    const gw = gatewayFalso(true);
    const s = new CobrancaOnlineService(gw, MANUAL_DESLIGADO, uowFalso());
    const r = await s.gerar({
      intencao: intencao(),
      descricao: 'x',
      comanda,
      meio: 'CARTAO_CREDITO',
    });
    expect(gw.criarCobrancaPix).not.toHaveBeenCalled();
    expect(r.cobranca).toBeNull();
    expect(r.pagamentoManual).toBeNull();
    expect(r.checkoutCartao).toEqual({ intencaoId: 'int-1', expiraEm: EXPIRA.toISOString() });
  });

  it('cartão devolve o MESMO expiraEm da intenção — a janela não é renovada', async () => {
    const s = new CobrancaOnlineService(gatewayFalso(true), MANUAL_DESLIGADO, uowFalso());
    const i = intencao();
    const r = await s.gerar({
      intencao: i,
      descricao: 'x',
      comanda,
      meio: 'CARTAO_CREDITO',
    });
    expect(r.checkoutCartao!.expiraEm).toBe(i.expiraEm!.toISOString());
  });

  it('★ modo manual VENCE o meio escolhido — nem PIX nem cartão são gerados', async () => {
    // A precedência importa: com a ponte do WhatsApp ligada, um `meio` vindo de um
    // estado salvo no navegador do cliente não pode fazer o sistema cobrar.
    const gw = gatewayFalso(true);
    const s = new CobrancaOnlineService(gw, MANUAL_LIGADO, uowFalso());
    const r = await s.gerar({
      intencao: intencao(),
      descricao: 'x',
      comanda,
      meio: 'CARTAO_CREDITO',
    });
    expect(gw.criarCobrancaPix).not.toHaveBeenCalled();
    expect(r.checkoutCartao).toBeNull();
    expect(r.cobranca).toBeNull();
    expect(r.pagamentoManual?.whatsappUrl).toContain('wa.me');
  });

  it('cartão em gateway sem suporte falha (defesa em profundidade, já barrado na borda)', async () => {
    const s = new CobrancaOnlineService(gatewayFalso(false), MANUAL_DESLIGADO, uowFalso());
    await expect(
      s.gerar({ intencao: intencao(), descricao: 'x', comanda, meio: 'CARTAO_CREDITO' }),
    ).rejects.toThrow(/não cobra cartão/i);
  });
});
