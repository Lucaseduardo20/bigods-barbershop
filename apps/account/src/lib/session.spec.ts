import { describe, expect, it } from 'vitest';
import { resolverSessaoInicial, sessaoDaQuery } from './session';

describe('resolverSessaoInicial', () => {
  it('BUG DE SEGURANÇA (E.7, sessão-C): handoff da URL SEMPRE vence sessão já salva — prova isolamento entre dois clientes distintos', () => {
    // Dispositivo compartilhado: cliente A já tinha sessão salva neste navegador/tablet.
    const sessaoDeA = { token: 'tok-a.123', cliente: { id: 'cli-a', nome: 'Cliente A', telefone: '+5511900000001' } };
    // Cliente B acabou de comprar e clicou no link de handoff pós-compra (prova FRESCA via OTP).
    const queryDeB = '?token=tok-b.456&clienteId=cli-b&clienteNome=Cliente%20B&clienteTelefone=%2B5511900000002';

    const resolvida = resolverSessaoInicial(queryDeB, sessaoDeA);

    expect(resolvida).toEqual({
      token: 'tok-b.456',
      cliente: { id: 'cli-b', nome: 'Cliente B', telefone: '+5511900000002' },
    });
    expect(resolvida).not.toEqual(sessaoDeA); // nunca cai na conta de A
  });

  it('sem handoff na URL, mantém a sessão salva (acesso normal, revisita)', () => {
    const sessaoSalva = { token: 'tok-x.789', cliente: { id: 'cli-x', nome: 'Cliente X', telefone: '+5511900000003' } };
    expect(resolverSessaoInicial('', sessaoSalva)).toEqual(sessaoSalva);
  });

  it('sem handoff e sem sessão salva: null (vai pro login)', () => {
    expect(resolverSessaoInicial('', null)).toBeNull();
  });
});

describe('sessaoDaQuery', () => {
  it('bug 1: reconstrói a sessão a partir do handoff do onboarding pós-compra', () => {
    const search = '?token=tok-abc.123&clienteId=cli-1&clienteNome=Jo%C3%A3o%20Exemplo&clienteTelefone=%2B5511999998888';
    expect(sessaoDaQuery(search)).toEqual({
      token: 'tok-abc.123',
      cliente: { id: 'cli-1', nome: 'João Exemplo', telefone: '+5511999998888' },
    });
  });

  it('retorna null quando não há parâmetros de handoff (acesso normal)', () => {
    expect(sessaoDaQuery('')).toBeNull();
  });

  it('retorna null quando faltam campos obrigatórios', () => {
    expect(sessaoDaQuery('?token=tok-abc')).toBeNull();
  });
});
