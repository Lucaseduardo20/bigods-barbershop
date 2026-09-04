import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { validarSenhaDeCliente } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { hashSenha } from '../infrastructure/senha';

export interface DefinirSenhaDoClientePeloAdminInput {
  companyId: string;
  clienteId: string;
  senha: string;
}

/**
 * ★★ O ADMIN DEFINE A SENHA DE UM CLIENTE (2026-09-04) — é isto que destrava
 * quem pagou pacote e não consegue entrar.
 *
 * ## Por que o admin, e não o cliente
 *
 * O autosserviço ("crie sua senha", "esqueci minha senha") depende de provar
 * posse do telefone, e provar posse do telefone é exatamente o que está
 * quebrado: o SMS não chega. Enquanto isso, quem conhece o cliente é a
 * barbearia — ela define a senha e passa por WhatsApp, no mesmo canal em que já
 * fala com ele todo dia.
 *
 * É deliberadamente uma medida de operação, não de segurança máxima: o admin
 * conhece a senha que definiu. O cliente troca quando o autosserviço voltar (ver
 * DECISOES_PENDENTES), e o que se protege aqui é o acesso ao crédito que ele já
 * pagou — o risco de ele não conseguir usar é concreto e presente; o de o dono
 * da barbearia entrar na conta do próprio cliente é teórico.
 *
 * ## O motor é o do staff
 *
 * `hashSenha` é o mesmo módulo `senha.ts` do login do painel — scrypt, sal por
 * senha, comparação em tempo constante. Não existe uma segunda implementação de
 * hash neste sistema, e não é aqui que ela vai nascer.
 */
@Injectable()
export class DefinirSenhaDoClientePeloAdminUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: DefinirSenhaDoClientePeloAdminInput): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const cliente = await repos.clientes.porId(input.clienteId);
      if (!cliente || cliente.companyId !== input.companyId) {
        throw new NotFoundException('Cliente não encontrado');
      }

      // A MESMA regra que o front usa (`packages/contracts`), aplicada aqui
      // porque validação só no front é um curl de distância. O telefone entra
      // na conta: senha igual ao telefone é o primeiro palpite de quem tem o
      // número — e o número É o login.
      const problema = validarSenhaDeCliente(input.senha, cliente.telefone.e164);
      if (!problema.ok) {
        throw new BadRequestException(problema.erro!);
      }

      cliente.definirSenha(hashSenha(input.senha));
      await repos.clientes.salvar(cliente);
    });
  }
}
