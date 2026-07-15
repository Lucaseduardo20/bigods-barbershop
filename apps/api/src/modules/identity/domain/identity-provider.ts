/**
 * Porta de identidade do CLIENTE FINAL (login OTP por telefone). TypeScript puro.
 *
 * Um único ponto de troca entre o modo demo (sem AWS) e o Cognito real: a
 * aplicação e o domínio dependem SÓ desta interface. Trocar demo↔produção é
 * variável de ambiente (`IDENTITY_PROVIDER`), zero mudança de código acima daqui.
 *
 * Não confundir com `AuthProvider` (login de staff/admin do painel) — são
 * preocupações separadas.
 */

export interface ProvisionarUsuarioInput {
  companyId: string;
  telefoneE164: string;
}

export interface IniciarLoginInput {
  companyId: string;
  telefoneE164: string;
}

export interface ConfirmarLoginInput {
  companyId: string;
  telefoneE164: string;
  codigo: string;
  /** Token opaco devolvido por `iniciarLogin` (ex.: Session do Cognito). */
  desafio: string;
}

export interface DesafioLogin {
  /** Token opaco a ser reapresentado na confirmação. Vazio quando não aplicável. */
  desafio: string;
  /** Quando o código expira (para a UI exibir contagem). */
  expiraEm: Date;
  /**
   * SOMENTE no provider demo com `DEMO_MODE=true`: o código em claro, para
   * testar sem SMS. `null` em qualquer outro caso (nunca vaza em produção).
   */
  codigoDemo: string | null;
}

export interface ResultadoConfirmacao {
  /** Identificador externo do usuário (Cognito sub / demo sub) → vira `Cliente.cognitoSub`. */
  sub: string;
}

export interface IdentityProvider {
  /**
   * Garante que exista um usuário externo para o telefone (idempotente).
   * Chamado quando o cliente passa a ter direito a login (compra de pacote).
   * NÃO autentica nem prova posse do telefone — só habilita o login futuro.
   */
  provisionarUsuario(input: ProvisionarUsuarioInput): Promise<void>;

  /**
   * Inicia o login: dispara o código OTP (SMS em produção). Para telefones não
   * provisionados, retorna um desafio neutro SEM código — resposta indistinguível
   * para não revelar quem é ou não cliente (resistência a enumeração).
   */
  iniciarLogin(input: IniciarLoginInput): Promise<DesafioLogin>;

  /**
   * Confirma o login com o código. Retorna o `sub` externo se válido; `null`
   * se o código estiver errado, expirado, ou o telefone não provisionado.
   * (Segue o padrão do `AuthProvider.validarCredenciais`: falha = null, a
   * camada de aplicação decide o status HTTP.)
   */
  confirmarLogin(input: ConfirmarLoginInput): Promise<ResultadoConfirmacao | null>;
}

export const IDENTITY_PROVIDER = Symbol('IdentityProvider');
