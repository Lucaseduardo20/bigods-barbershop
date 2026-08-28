import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Telefone } from '../../../shared/domain/telefone';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { IDENTITY_PROVIDER, IdentityProvider } from '../domain/identity-provider';
import { ClienteSessaoService } from '../infrastructure/cliente-sessao.service';
import { Cliente, NOME_PLACEHOLDER } from '../../customers/domain/cliente.aggregate';

export interface ConfirmarLoginClienteInput {
  /**
   * Nome para o caso de o `Cliente` ainda não existir. Ignorado quando já
   * existe — este caso de uso nunca renomeia ninguém.
   */
  nome?: string;
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
      let cliente = await repos.clientes.porTelefone(input.companyId, telefone);
      if (!cliente) {
        // Bug 2: o código já provou posse do telefone — não há mais razão para
        // barrar quem nunca comprou nada (nem pacote, nem avulso). Cria o
        // Cliente aqui; a área logada mostra a home vazia normal ("sem pacotes
        // ainda, agende seu primeiro horário") em vez de travar num erro.
        //
        // ★ `nome` (2026-08-21): o funil JÁ perguntou o nome antes de pedir o
        // código, então ele manda junto e o Cliente nasce com nome de verdade.
        // Sem isto, o cliente nascia com o placeholder e só era corrigido pelo
        // agendamento seguinte — se esse agendamento falhasse (horário
        // indisponível, conflito, desistência), ficava "Cliente" pra sempre.
        // Era uma dependência de ORDEM, e foi assim que o placeholder continuou
        // aparecendo no banco mesmo depois das correções anteriores.
        //
        // Só vale na CRIAÇÃO: cliente que já existe não é tocado aqui, e o
        // login não é caminho para renomear ninguém.
        cliente = Cliente.criar({
          id: randomUUID(),
          companyId: input.companyId,
          nome: input.nome?.trim() || NOME_PLACEHOLDER,
          telefone,
        });
        await repos.clientes.salvar(cliente);
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
      // ★ Este é o instante em que a posse do telefone foi provada. É ele que
      // deixa o cliente definir a senha do primeiro acesso sem um segundo
      // código — e que expira em 30 min (§8.16).
      verificadoEm: Date.now(),
    });
    return {
      token,
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone.e164 },
    };
  }
}
