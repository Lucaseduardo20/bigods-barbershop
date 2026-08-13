import { describe, expect, it } from 'vitest';
import { Papel } from '@bigods/contracts';
import { Barbeiro } from './barbeiro.aggregate';
import { assertNaoRemoveUltimoAdminAtivo } from './regra-admin-minimo';
import { Percentual } from '../../../shared/domain/percentual';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

function admin(id: string, ativo = true): Barbeiro {
  const b = Barbeiro.criar({
    id,
    companyId: 'co-1',
    nome: id,
    slug: id,
    papeis: new Set([Papel.ADMIN]),
    comissaoPadrao: Percentual.dePorcentagem(0),
    ativo,
  });
  return b;
}

function barbeiroComum(id: string): Barbeiro {
  return Barbeiro.criar({
    id,
    companyId: 'co-1',
    nome: id,
    slug: id,
    papeis: new Set([Papel.BARBEIRO]),
    comissaoPadrao: Percentual.dePorcentagem(45),
  });
}

describe('regra-admin-minimo — trava de segurança operacional', () => {
  it('bloqueia desativar/rebaixar o ÚNICO admin ativo', () => {
    const todos = [admin('a1'), barbeiroComum('b1')];
    expect(() => assertNaoRemoveUltimoAdminAtivo(todos, 'a1', false)).toThrow(InvarianteVioladaError);
  });

  it('permite desativar/rebaixar um admin quando existe outro admin ativo', () => {
    const todos = [admin('a1'), admin('a2')];
    expect(() => assertNaoRemoveUltimoAdminAtivo(todos, 'a1', false)).not.toThrow();
  });

  it('admin JÁ inativo não conta como "outro admin ativo" — segundo admin também travado', () => {
    const todos = [admin('a1'), admin('a2', false)];
    expect(() => assertNaoRemoveUltimoAdminAtivo(todos, 'a1', false)).toThrow(InvarianteVioladaError);
  });

  it('não bloqueia quando o alvo continua admin ativo depois da mudança', () => {
    const todos = [admin('a1')];
    expect(() => assertNaoRemoveUltimoAdminAtivo(todos, 'a1', true)).not.toThrow();
  });

  it('permite reativar/promover livremente (nunca bloqueia adicionar admin)', () => {
    const todos = [barbeiroComum('b1')];
    expect(() => assertNaoRemoveUltimoAdminAtivo(todos, 'b1', true)).not.toThrow();
  });
});
