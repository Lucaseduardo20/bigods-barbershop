import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PacoteVendido } from '../../packages/domain/venda-de-pacote.events';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { IDENTITY_PROVIDER, IdentityProvider } from '../domain/identity-provider';

/**
 * §5: a compra de um pacote dá ao cliente direito a login (área logada). Este
 * handler **provisiona** o usuário externo (Cognito/demo) — cria a POSSIBILIDADE
 * de login.
 *
 * NÃO preenche `Cliente.cognitoSub` aqui: isso só acontece quando o cliente
 * confirma o código OTP e prova posse do telefone (ver ConfirmarLoginClienteUseCase).
 * Provisionar antes da prova de posse permitiria "sequestrar" o telefone de outro.
 */
@Injectable()
export class OnPacoteVendidoHandler {
  private readonly logger = new Logger(OnPacoteVendidoHandler.name);

  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  @OnEvent('PacoteVendido')
  async handle(evento: PacoteVendido): Promise<void> {
    const cliente = await this.clientes.porId(evento.clienteId);
    if (!cliente) {
      this.logger.error(`Cliente ${evento.clienteId} não encontrado para provisionar`);
      return;
    }
    // Idempotente — comprar outro pacote não duplica o usuário externo.
    await this.identity.provisionarUsuario({
      companyId: cliente.companyId,
      telefoneE164: cliente.telefone.e164,
    });
  }
}
