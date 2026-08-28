import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { validarSenhaDeCliente } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { hashSenha } from '../infrastructure/senha';
import { ClienteAutenticado, ClienteSessaoService } from '../infrastructure/cliente-sessao.service';

export interface DefinirSenhaClienteInput {
  sessao: ClienteAutenticado;
  senha: string;
  /** Injetável para teste; em produção é o relógio do processo. */
  agora?: number;
}

/**
 * ★★ PRIMEIRO ACESSO — o cliente escolhe uma senha (2026-08-28).
 *
 * Serve aos dois caminhos que terminam em "agora escolha sua senha": o cliente
 * que acabou de agendar e veio pela ponte do funil, e o que pediu "esqueci
 * minha senha" e acabou de confirmar o código. Nos dois, o que autoriza é o
 * MESMO fato — o telefone foi verificado há pouco.
 *
 * ## Por que a verificação precisa ser RECENTE
 *
 * A sessão do cliente vale 30 dias, porque ele loga raramente. Se qualquer
 * sessão válida pudesse trocar a senha, um celular emprestado ou esquecido
 * numa mesa viraria a senha da conta de outra pessoa — e o dono legítimo
 * descobriria só quando não conseguisse mais entrar. A janela de 30 minutos
 * (`JANELA_DE_VERIFICACAO_MS`) cobre o caminho real com folga e fecha essa
 * porta.
 *
 * ## O motor é o do staff
 *
 * O hash sai de `senha.ts` — scrypt com sal por senha, o MESMO módulo que o
 * login do painel usa e que os seeds usam. Não existe uma segunda
 * implementação de hash de senha neste sistema, e não é aqui que ela vai
 * nascer: criptografia reescrita é onde as vulnerabilidades moram.
 */
@Injectable()
export class DefinirSenhaClienteUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly sessaoService: ClienteSessaoService,
  ) {}

  async executar(input: DefinirSenhaClienteInput): Promise<void> {
    const agora = input.agora ?? Date.now();
    if (!this.sessaoService.verificacaoRecente(input.sessao, agora)) {
      // Mensagem que diz o que fazer, não só o que deu errado: quem cai aqui
      // está com uma sessão antiga e precisa do caminho do código.
      throw new ForbiddenException(
        'Para definir sua senha, confirme seu telefone de novo — o código expira em 30 minutos.',
      );
    }

    await this.uow.transacao(async (repos) => {
      const cliente = await repos.clientes.porId(input.sessao.clienteId);
      if (!cliente || cliente.companyId !== input.sessao.companyId) {
        throw new NotFoundException('Cliente não encontrado');
      }

      // A MESMA regra do front (`packages/contracts`), aplicada aqui porque
      // validação só no front é um curl de distância. O telefone entra na
      // conta: senha igual ao telefone é o primeiro palpite de quem tem o
      // login em mãos — e o login É o telefone.
      const problema = validarSenhaDeCliente(input.senha, cliente.telefone.e164);
      if (!problema.ok) {
        throw new BadRequestException(problema.erro!);
      }

      cliente.definirSenha(hashSenha(input.senha));
      await repos.clientes.salvar(cliente);
    });
  }
}
