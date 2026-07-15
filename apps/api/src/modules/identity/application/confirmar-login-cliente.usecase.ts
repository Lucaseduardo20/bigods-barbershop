import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Telefone } from '../../../shared/domain/telefone';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { IDENTITY_PROVIDER, IdentityProvider } from '../domain/identity-provider';
import { ClienteSessaoService } from '../infrastructure/cliente-sessao.service';

export interface ConfirmarLoginClienteInput {
  companyId: string;
  telefone: string;
  codigo: string;
  desafio: string;
}

export interface ConfirmarLoginClienteOutput {
  token: string;
  cliente: { id: string; nome: string; telefone: string };
}

/**
 * §3.4: confirma o código OTP. Só AQUI o `Cliente.cognitoSub` é preenchido —
 * nunca na compra do pacote — porque é o momento em que o cliente prova posse
 * do telefone. A partir daí ele tem sessão na área logada.
 */
@Injectable()
export class ConfirmarLoginClienteUseCase {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly sessao: ClienteSessaoService,
  ) {}

  async executar(input: ConfirmarLoginClienteInput): Promise<ConfirmarLoginClienteOutput> {
    const telefone = Telefone.de(input.telefone);

    const resultado = await this.identity.confirmarLogin({
      companyId: input.companyId,
      telefoneE164: telefone.e164,
      codigo: input.codigo,
      desafio: input.desafio,
    });
    if (!resultado) {
      throw new UnauthorizedException('Código inválido ou expirado');
    }

    // Reconcilia o cliente por telefone e promove a usuário (idempotente).
    const cliente = await this.uow.transacao(async (repos) => {
      const cliente = await repos.clientes.porTelefone(input.companyId, telefone);
      if (!cliente) {
        // Só há sub válido porque o telefone foi provisionado (comprou pacote),
        // o que sempre cria um Cliente. Ausência aqui é inconsistência — não vaza.
        throw new UnauthorizedException('Não foi possível entrar');
      }
      if (!cliente.ehUsuario) {
        cliente.promoverParaUsuario(resultado.sub);
        await repos.clientes.salvar(cliente);
      }
      return cliente;
    });

    const token = this.sessao.emitir({
      clienteId: cliente.id,
      companyId: cliente.companyId,
      sub: resultado.sub,
    });
    return {
      token,
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone.e164 },
    };
  }
}
