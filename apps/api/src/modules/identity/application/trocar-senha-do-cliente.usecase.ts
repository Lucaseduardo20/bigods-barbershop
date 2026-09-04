import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { validarSenhaDeCliente } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { hashSenha, verificaSenha } from '../infrastructure/senha';

export interface TrocarSenhaDoClienteInput {
  companyId: string;
  clienteId: string;
  senhaAtual: string;
  novaSenha: string;
}

/**
 * ★ O CLIENTE TROCA A PRÓPRIA SENHA (2026-09-04).
 *
 * Existe porque hoje quem define a senha de um cliente antigo é o ADMIN — ou
 * seja, uma pessoa da barbearia conhece a senha dele. Sem esta tela, essa senha
 * seria definitiva; com ela, o cliente entra uma vez e faz a dela.
 *
 * ## Exige a senha ATUAL
 *
 * Mesmo padrão do "alterar senha" do staff (`AuthController.trocarSenha`), e
 * pela mesma razão: a sessão do cliente dura 30 dias e vive num celular. Um
 * aparelho destravado esquecido no balcão não pode trocar a senha e trancar o
 * dono para fora da própria conta — quem troca prova que sabe a atual.
 *
 * ## Quem ainda não tem senha não passa por aqui
 *
 * Não há senha atual para conferir, e "defina a sua agora" numa sessão que
 * pode ter sido aberta de qualquer jeito é exatamente a brecha que a
 * contingência evita no funil. Cliente sem senha é destravado pelo admin.
 */
@Injectable()
export class TrocarSenhaDoClienteUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: TrocarSenhaDoClienteInput): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const cliente = await repos.clientes.porId(input.clienteId);
      if (!cliente || cliente.companyId !== input.companyId) {
        throw new NotFoundException('Cliente não encontrado');
      }
      const hash = cliente.senhaHash;
      if (!hash) {
        throw new BadRequestException(
          'Sua conta ainda não tem senha. Fale com a barbearia para ativar seu acesso.',
        );
      }
      if (!verificaSenha(input.senhaAtual, hash)) {
        throw new UnauthorizedException('Senha atual incorreta');
      }
      if (input.novaSenha === input.senhaAtual) {
        throw new BadRequestException('A nova senha precisa ser diferente da atual');
      }
      const problema = validarSenhaDeCliente(input.novaSenha, cliente.telefone.e164);
      if (!problema.ok) {
        throw new BadRequestException(problema.erro!);
      }
      cliente.definirSenha(hashSenha(input.novaSenha));
      await repos.clientes.salvar(cliente);
    });
  }
}
