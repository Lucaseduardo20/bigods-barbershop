import type { ConfirmarLoginClienteResponse } from '@bigods/contracts';

/**
 * Bug 1: o onboarding pós-compra confirma o MESMO OTP usado pela área do
 * cliente (§3.4), mas os dois apps vivem em origens diferentes — sem isso, o
 * token emitido aqui nunca chega à área logada e o cliente precisa fazer um
 * segundo OTP lá. Repassamos a sessão já autenticada via querystring; a área
 * do cliente lê e estabelece a sessão sem pedir código de novo.
 */
export function linkDeContaComSessao(accountUrl: string, sessao: ConfirmarLoginClienteResponse): string {
  const params = new URLSearchParams({
    token: sessao.token,
    clienteId: sessao.cliente.id,
    clienteNome: sessao.cliente.nome,
    clienteTelefone: sessao.cliente.telefone,
  });
  return `${accountUrl}/?${params.toString()}`;
}
