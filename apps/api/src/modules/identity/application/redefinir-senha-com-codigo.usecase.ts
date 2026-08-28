import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfirmarLoginClienteUseCase } from './confirmar-login-cliente.usecase';
import { DefinirSenhaClienteUseCase } from './definir-senha-cliente.usecase';
import { ClienteSessaoService } from '../infrastructure/cliente-sessao.service';

export interface RedefinirSenhaComCodigoInput {
  companyId: string;
  telefone: string;
  codigo: string;
  desafio: string;
  senha: string;
}

export interface RedefinirSenhaComCodigoOutput {
  token: string;
  cliente: { id: string; nome: string; telefone: string };
}

/**
 * ★ "ESQUECI MINHA SENHA" (2026-08-28) — o único lugar, fora do agendamento,
 * em que ainda sai um código.
 *
 * É a composição de dois passos que já existem, e é de propósito que não seja
 * uma terceira implementação: confirmar o código é exatamente o mesmo fato do
 * login por código (valida, cria/promove o cliente, emite sessão marcada como
 * verificada AGORA), e definir a senha é exatamente o mesmo fato do primeiro
 * acesso.
 *
 * Serve também a quem NUNCA teve senha — o cliente que já era da casa antes
 * desta mudança e não passou pela ponte do funil. Para ele este é o caminho de
 * primeiro acesso, e é por isso que o fluxo não exige senha anterior.
 *
 * A senha só é trocada DEPOIS do código conferir: se o código falhar, nada é
 * gravado e a senha antiga (quando existe) continua valendo.
 */
@Injectable()
export class RedefinirSenhaComCodigoUseCase {
  constructor(
    private readonly confirmarLogin: ConfirmarLoginClienteUseCase,
    private readonly definirSenha: DefinirSenhaClienteUseCase,
    private readonly sessaoService: ClienteSessaoService,
  ) {}

  async executar(input: RedefinirSenhaComCodigoInput): Promise<RedefinirSenhaComCodigoOutput> {
    const confirmado = await this.confirmarLogin.executar({
      companyId: input.companyId,
      telefone: input.telefone,
      codigo: input.codigo,
      desafio: input.desafio,
    });

    // A sessão recém-emitida é a prova de posse do telefone; ler de volta o
    // token evita montar um `ClienteAutenticado` à mão e divergir do que o
    // guard vai enxergar.
    const sessao = this.sessaoService.verificar(confirmado.token);
    if (!sessao) {
      throw new UnauthorizedException('Sessão inválida');
    }

    await this.definirSenha.executar({ sessao, senha: input.senha });
    return confirmado;
  }
}
