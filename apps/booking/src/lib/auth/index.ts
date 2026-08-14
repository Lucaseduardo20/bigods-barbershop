import type { ConfirmarLoginClienteResponse } from '@bigods/contracts';
import { criarAdapterApi } from './api.adapter';
import { criarAdapterCognito } from './cognito.adapter';

/**
 * Porta de verificação de telefone do funil — a UI (`OtpVerificacao`) fala SÓ
 * com isto e não sabe quem prova a posse do telefone por baixo.
 *
 * Existem dois adapters, e eles NÃO se substituem em produção por acidente:
 *  - `api`     — o de sempre: a nossa API orquestra o OTP (`/conta/login/*`),
 *                código pelo WhatsApp. É o default e continua intocado.
 *  - `cognito` — experimento: o navegador autentica direto no Cognito via
 *                Amplify (CUSTOM_AUTH), com o código chegando pelo MESMO
 *                WhatsApp (quem envia é o trigger `create-auth-challenge`),
 *                e a API só troca o `idToken` resultante pela sessão do
 *                cliente.
 *
 * Os dois terminam devolvendo a MESMA `ConfirmarLoginClienteResponse` — é o
 * que permite trocar um pelo outro sem tocar em nenhuma tela.
 */
export interface DesafioIniciado {
  /** Token opaco reapresentado na confirmação. Vazio no Cognito (o Amplify guarda a sessão internamente). */
  desafio: string;
  /** Só no modo demo da nossa API. Sempre null no caminho do Cognito. */
  codigoDemo: string | null;
}

export interface AuthClienteAdapter {
  readonly nome: 'api' | 'cognito';
  /** Dispara o envio do código para o telefone. */
  iniciar(telefone: string): Promise<DesafioIniciado>;
  /** Confirma o código e devolve a sessão de cliente da nossa aplicação. */
  confirmar(entrada: {
    telefone: string;
    codigo: string;
    desafio: string;
  }): Promise<ConfirmarLoginClienteResponse>;
}

/** `api` (default) | `cognito`. Ver `.env.frontends.example`. */
export type NomeDoAdapter = AuthClienteAdapter['nome'];

export function adapterConfigurado(): NomeDoAdapter {
  const bruto = (import.meta.env.VITE_AUTH_ADAPTER as string | undefined)?.trim().toLowerCase();
  if (!bruto || bruto === 'api') return 'api';
  if (bruto === 'cognito') return 'cognito';
  // Valor desconhecido nunca vira "usa o default e segue" silencioso — o
  // deploy está mal configurado e precisa aparecer (CLAUDE.md: sem fallback mudo).
  throw new Error(`VITE_AUTH_ADAPTER='${bruto}' desconhecido. Valores aceitos: 'api', 'cognito'.`);
}

export function criarAuthAdapter(): AuthClienteAdapter {
  return adapterConfigurado() === 'cognito' ? criarAdapterCognito() : criarAdapterApi();
}
