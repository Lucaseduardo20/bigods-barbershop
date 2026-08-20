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

  describe('renomear — corrige o placeholder do login OTP sem cadastro prévio', () => {
    it('sobrescreve o nome com o que veio digitado agora', () => {
      const c = Cliente.criar({ id: 'cli-1', companyId: 'co-1', nome: 'Cliente', telefone: Telefone.de('11999998888') });
      c.renomear('Maria Silva');
      expect(c.nome).toBe('Maria Silva');
    });

    it('nome vazio/só espaço não apaga o nome já existente', () => {
      const c = criar();
      c.renomear('   ');
      expect(c.nome).toBe('João');
    });

    it('remove espaços nas pontas', () => {
      const c = criar();
      c.renomear('  Pedro Souza  ');
      expect(c.nome).toBe('Pedro Souza');
    });
  });
});
