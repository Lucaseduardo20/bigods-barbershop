import { describe, expect, it } from 'vitest';
import { sessaoDaQuery } from './session';

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
