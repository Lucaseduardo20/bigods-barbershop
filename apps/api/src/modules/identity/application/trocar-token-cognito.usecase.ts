import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Telefone } from '../../../shared/domain/telefone';
import {
  COGNITO_TOKEN_VERIFIER,
  CognitoTokenVerifier,
} from '../domain/cognito-token-verifier';
import { SessaoDoClienteService } from './sessao-do-cliente.service';
import { SessaoEmitida } from './sessao-do-cliente.service';

export interface TrocarTokenCognitoInput {
  companyId: string;
  idToken: string;
}

/**
 * Experimento "Amplify no funil": o navegador fez o OTP direto no Cognito
 * (`CUSTOM_AUTH`, com o código chegando pelo MESMO WhatsApp de sempre — o
 * trigger `create-auth-challenge` é quem manda) e volta com um `idToken`.
 * Aqui a API confere esse token e devolve a NOSSA sessão de cliente.
 *
 * Por que trocar em vez de aceitar o token do Cognito direto nos guards: todo o
 * sistema autoriza por `ClienteSessaoService` (`@ContaCliente()`), que carrega
 * `clienteId` e `companyId` — coisas que o token do Cognito não sabe. Trocar
 * aqui mantém UM mecanismo de autorização em vez de dois convivendo, e é o que
 * permite ligar/desligar o experimento sem mexer em nenhum outro controller.
 *
 * Convive com `ConfirmarLoginClienteUseCase` (o OTP pela nossa API) — os dois
 * terminam no mesmo `SessaoDoClienteService`, então o cliente resultante é
 * idêntico venha por onde vier.
 */
@Injectable()
export class TrocarTokenCognitoUseCase {
  constructor(
    @Optional()
    @Inject(COGNITO_TOKEN_VERIFIER)
    private readonly verifier: CognitoTokenVerifier | null,
    private readonly sessaoDoCliente: SessaoDoClienteService,
  ) {}

  async executar(input: TrocarTokenCognitoInput): Promise<SessaoEmitida> {
    // Instalação sem Cognito configurado (o caso de hoje em produção, que roda
    // no WhatsApp): o endpoint existe mas recusa explicitamente, em vez de
    // fingir que autenticou ou estourar um erro obscuro de config faltando.
    if (!this.verifier) {
      throw new ServiceUnavailableException('Login via Cognito não está habilitado nesta instalação');
    }

    const verificado = await this.verifier.verificar(input.idToken);
    if (!verificado) {
      throw new UnauthorizedException('Token do Cognito inválido ou expirado');
    }

    let telefone: Telefone;
    try {
      telefone = Telefone.de(verificado.telefoneE164);
    } catch {
      // Token válido mas com telefone que não normaliza: é problema de cadastro
      // no User Pool, não credencial ruim — mas continua sendo "não autentica".
      throw new UnauthorizedException('Token do Cognito sem telefone utilizável');
    }

    return this.sessaoDoCliente.reconciliarEEmitir({
      companyId: input.companyId,
      telefone,
      sub: verificado.sub,
    });
  }
}
