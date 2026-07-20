import { describe, expect, it } from 'vitest';
import { linkDeContaComSessao } from './handoff';

describe('linkDeContaComSessao', () => {
  it('bug 1: embute o token de sessão já autenticado no link da área do cliente', () => {
    const link = linkDeContaComSessao('http://localhost:5175', {
      token: 'tok-abc.123',
      cliente: { id: 'cli-1', nome: 'João Exemplo', telefone: '+5511999998888' },
    });
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe('http://localhost:5175/');
    expect(url.searchParams.get('token')).toBe('tok-abc.123');
    expect(url.searchParams.get('clienteId')).toBe('cli-1');
    expect(url.searchParams.get('clienteNome')).toBe('João Exemplo');
    expect(url.searchParams.get('clienteTelefone')).toBe('+5511999998888');
  });
});
