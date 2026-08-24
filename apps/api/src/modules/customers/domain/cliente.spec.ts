import { describe, expect, it } from 'vitest';
import { Cliente, NOME_PLACEHOLDER } from './cliente.aggregate';
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

describe('Cliente — o funil não sobrescreve nome (2026-08-21)', () => {
  const comNome = (nome: string) =>
    Cliente.criar({
      id: 'cli-1',
      companyId: 'co-1',
      nome,
      telefone: Telefone.de('11 98888-7777'),
    });

  it('★ quem JÁ TEM nome não é renomeado pelo funil', () => {
    const c = comNome('Rafael Grigio');
    expect(c.adotarNomeSeAusente('Rafa')).toBe(false);
    expect(c.nome).toBe('Rafael Grigio');
  });

  it('quem só tem o placeholder do login OTP recebe o nome digitado', () => {
    const c = comNome(NOME_PLACEHOLDER);
    expect(c.nomeEhPlaceholder).toBe(true);
    expect(c.adotarNomeSeAusente('Rafael Grigio')).toBe(true);
    expect(c.nome).toBe('Rafael Grigio');
    expect(c.nomeEhPlaceholder).toBe(false);
  });

  it('nome vazio não apaga o placeholder — continua esperando um nome de verdade', () => {
    const c = comNome(NOME_PLACEHOLDER);
    expect(c.adotarNomeSeAusente('   ')).toBe(false);
    expect(c.nomeEhPlaceholder).toBe(true);
  });

  it('renomear continua existindo para quem tiver direito de renomear', () => {
    const c = comNome('Rafael Grigio');
    c.renomear('Rafael G.');
    expect(c.nome).toBe('Rafael G.');
  });
});
