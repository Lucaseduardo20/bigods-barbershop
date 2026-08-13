import { Papel } from '@bigods/contracts';
import { Barbeiro } from './barbeiro.aggregate';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';

/**
 * Trava de segurança operacional: o sistema nunca pode ficar sem NENHUM admin
 * ativo — senão alguém se tranca pra fora do próprio painel em produção.
 * Cross-agregado (precisa olhar todos os barbeiros da empresa), por isso é
 * função pura de domínio em vez de método do agregado `Barbeiro`.
 *
 * `continuaAdminAtivo` é o estado FUTURO do alvo (depois da mudança que o
 * caller está prestes a aplicar) — chamar ANTES de persistir.
 */
export function assertNaoRemoveUltimoAdminAtivo(
  todos: Barbeiro[],
  alvoId: string,
  continuaAdminAtivo: boolean,
): void {
  if (continuaAdminAtivo) return;
  const existeOutroAdminAtivo = todos.some(
    (b) => b.id !== alvoId && b.ativo && b.temPapel(Papel.ADMIN),
  );
  if (!existeOutroAdminAtivo) {
    throw new InvarianteVioladaError(
      'Não é possível remover o último admin ativo do sistema — cadastre outro admin antes.',
    );
  }
}
