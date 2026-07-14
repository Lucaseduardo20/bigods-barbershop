import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PacoteVendido } from '../../packages/domain/venda-de-pacote.events';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { IDENTITY_PROVIDER, IdentityProvider } from '../domain/identity-provider';

/** §5: compra de pacote promove o Cliente a usuário autenticável. */
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
      this.logger.error(`Cliente ${evento.clienteId} não encontrado para promoção`);
      return;
    }
    if (cliente.ehUsuario) return;
    const sub = await this.identity.provisionarUsuario(cliente.id, cliente.telefone.e164);
    cliente.promoverParaUsuario(sub);
    await this.clientes.salvar(cliente);
  }
}
