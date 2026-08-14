import type {
  ConfirmarLoginClienteResponse,
  IniciarLoginClienteResponse,
} from '@bigods/contracts';
import { api } from '../api';
import { COMPANY_ID } from '../config';
import type { AuthClienteAdapter, DesafioIniciado } from './index';

/**
 * O caminho de sempre: a nossa API orquestra o desafio OTP
 * (`/conta/login/iniciar` + `/conta/login/confirmar`) e o código sai pelo
 * WhatsApp. É exatamente o que `OtpVerificacao` fazia inline antes de existir
 * a porta — nada de comportamento mudou aqui, só o lugar do código.
 */
export function criarAdapterApi(): AuthClienteAdapter {
  return {
    nome: 'api',

    async iniciar(telefone: string): Promise<DesafioIniciado> {
      const r = await api<IniciarLoginClienteResponse>('/conta/login/iniciar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone },
      });
      return { desafio: r.desafio, codigoDemo: r.codigoDemo };
    },

    async confirmar({ telefone, codigo, desafio }): Promise<ConfirmarLoginClienteResponse> {
      return api<ConfirmarLoginClienteResponse>('/conta/login/confirmar', {
        method: 'POST',
        body: { companyId: COMPANY_ID, telefone, codigo, desafio },
      });
    },
  };
}
