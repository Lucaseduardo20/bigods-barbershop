import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Payload da sessão do cliente final (área logada). Separado da sessão de staff. */
export interface ClienteAutenticado {
  clienteId: string;
  companyId: string;
  sub: string;
  /**
   * Quando o TELEFONE foi verificado por código nesta sessão (epoch ms), ou
   * `null` se ela não nasceu de uma verificação — é o caso do login por senha,
   * e o de qualquer token emitido antes de 2026-08-28.
   *
   * Existe por uma razão só: DEFINIR SENHA no primeiro acesso exige posse do
   * telefone comprovada há pouco. Uma sessão vale 30 dias; um celular que fica
   * numa mesa por meia hora não pode virar a senha da conta de outra pessoa.
   */
  verificadoEm: number | null;
}

/**
 * Por quanto tempo uma verificação de telefone continua "recente" o bastante
 * para definir senha (2026-08-28).
 *
 * 30 minutos cobre com folga o caminho real — o cliente confirma o agendamento,
 * lê a tela de sucesso, clica em "ir para minha conta" e escolhe uma senha — e
 * fecha a janela em que um aparelho esquecido aberto viraria uma senha alheia.
 */
export const JANELA_DE_VERIFICACAO_MS = 30 * 60 * 1000;

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias — cliente final loga raramente

/**
 * Emite/valida o token de sessão do CLIENTE após o login OTP. Token próprio da
 * aplicação (HMAC), provider-agnóstico: vale igual com demo ou Cognito, porque
 * o guard valida ESTE token, não o JWT do Cognito. É o que garante "trocar
 * demo→produção é só variável de ambiente" na camada de autorização.
 */
@Injectable()
export class ClienteSessaoService {
  private readonly secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

  /** A sessão é recente o bastante para definir senha sem pedir código de novo? */
  verificacaoRecente(cliente: ClienteAutenticado, agora = Date.now()): boolean {
    return cliente.verificadoEm !== null && agora - cliente.verificadoEm <= JANELA_DE_VERIFICACAO_MS;
  }

  emitir(cliente: ClienteAutenticado): string {
    const payload = Buffer.from(JSON.stringify({ ...cliente, exp: Date.now() + TTL_MS })).toString(
      'base64url',
    );
    return `${payload}.${this.assinar(payload)}`;
  }

  verificar(token: string): ClienteAutenticado | null {
    const [payload, assinatura] = token.split('.');
    if (!payload || !assinatura) return null;
    const esperada = this.assinar(payload);
    const a = Buffer.from(assinatura);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const dados = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (typeof dados.exp !== 'number' || dados.exp < Date.now()) return null;
      return {
        clienteId: dados.clienteId,
        companyId: dados.companyId,
        sub: dados.sub,
        // Token antigo (anterior a 2026-08-28) não tem o campo: vale como
        // sessão, mas NÃO como verificação recente. Quem quiser definir senha
        // com um token desses passa pelo código, que é o caminho seguro.
        verificadoEm: typeof dados.verificadoEm === 'number' ? dados.verificadoEm : null,
      };
    } catch {
      return null;
    }
  }

  private assinar(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
