import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Telefone } from '../../../shared/domain/telefone';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { ClienteSessaoService } from '../infrastructure/cliente-sessao.service';
import { Cliente } from '../../customers/domain/cliente.aggregate';

export interface SessaoEmitida {
  token: string;
  cliente: { id: string; nome: string; telefone: string };
}

/**
 * O QUE ACONTECE depois que a posse do telefone foi provada — reconciliar o
 * `Cliente` por telefone, promovê-lo a usuário (§3.4) e emitir a sessão.
 *
 * Vive separado do caso de uso porque agora existem DOIS caminhos que chegam
 * aqui e não podem divergir:
 *  - `ConfirmarLoginClienteUseCase` — OTP orquestrado pela nossa API
 *    (`IdentityProvider`: demo/WhatsApp), o caminho de sempre;
 *  - `TrocarTokenCognitoUseCase` — o navegador autenticou direto no Cognito
 *    (Amplify) e traz um `idToken` já verificado.
 *
 * A prova de posse muda; o efeito sobre o `Cliente` e a sessão é idêntico —
 * então é UMA implementação só (CLAUDE.md: "mesma regra em dois lugares" é
 * anti-padrão explícito).
 */
@Injectable()
export class SessaoDoClienteService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly sessao: ClienteSessaoService,
  ) {}

  async reconciliarEEmitir(input: {
    companyId: string;
    telefone: Telefone;
    sub: string;
  }): Promise<SessaoEmitida> {
    const cliente = await this.uow.transacao(async (repos) => {
      let cliente = await repos.clientes.porTelefone(input.companyId, input.telefone);
      if (!cliente) {
        // Bug 2: a posse do telefone já foi provada — não há mais razão para
        // barrar quem nunca comprou nada (nem pacote, nem avulso). Cria o
        // Cliente aqui; a área logada mostra a home vazia normal ("sem pacotes
        // ainda, agende seu primeiro horário") em vez de travar num erro.
        // DECISAO_PENDENTE: nome placeholder até existir edição de perfil.
        cliente = Cliente.criar({
          id: randomUUID(),
          companyId: input.companyId,
          nome: 'Cliente',
          telefone: input.telefone,
        });
        await repos.clientes.salvar(cliente);
      }
      if (!cliente.ehUsuario) {
        cliente.promoverParaUsuario(input.sub);
        await repos.clientes.salvar(cliente);
      }
      return cliente;
    });

    const token = this.sessao.emitir({
      clienteId: cliente.id,
      companyId: cliente.companyId,
      sub: input.sub,
    });
    return {
      token,
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone.e164 },
    };
  }
}
