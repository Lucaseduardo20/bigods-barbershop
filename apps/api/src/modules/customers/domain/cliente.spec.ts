import { describe, expect, it } from 'vitest';
import { Cliente } from './cliente.aggregate';
import { Telefone } from '../../../shared/domain/telefone';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

const criar = () =>
  Cliente.criar({
    id: 'cli-1',
    companyId: 'co-1',
    nome: 'João',
    telefone: Telefone.de('11999998888'),
  });

describe('Cliente', () => {
  it('nasce sem conta (cognitoSub null)', () => {
    const c = criar();
    expect(c.cognitoSub).toBeNull();
    expect(c.ehUsuario).toBe(false);
  });

  it('promoção preenche cognitoSub', () => {
    const c = criar();
    c.promoverParaUsuario('sub-123');
    expect(c.ehUsuario).toBe(true);
    expect(c.cognitoSub).toBe('sub-123');
  });

  it('promoção é idempotente para o mesmo sub, mas rejeita sub diferente', () => {
    const c = criar();
    c.promoverParaUsuario('sub-123');
    c.promoverParaUsuario('sub-123');
    expect(() => c.promoverParaUsuario('sub-999')).toThrow(InvarianteVioladaError);
  });
});
