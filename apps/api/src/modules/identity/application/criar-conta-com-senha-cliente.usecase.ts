import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validarSenhaDeCliente } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import { Telefone } from '../../../shared/domain/telefone';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { Cliente } from '../../customers/domain/cliente.aggregate';
import { hashSenha } from '../infrastructure/senha';

export interface CriarContaComSenhaClienteInput {
  companyId: string;
  telefone: string;
  nome: string;
  senha: string;
}

/**
 * ★★ CLIENTE NOVO CRIA A PRÓPRIA SENHA NO FUNIL (2026-09-04).
 *
 * Só existe com a contingência de OTP ligada (a rota é fechada na borda — ver
 * `ContaClienteController`). Enquanto o SMS não chega, é o que dá conta a quem
 * está agendando pela primeira vez: em vez de uma tela de código que nunca
 * avança, ele escolhe uma senha e segue.
 *
 * ## O que esta senha NÃO é
 *
 * Não é prova de posse do telefone. Ninguém confirmou que o número digitado é
 * de quem está digitando — e é por isso que este caso de uso **não emite
 * sessão**. O agendamento continua nascendo `AGUARDANDO_APROVACAO` pelo caminho
 * anônimo de sempre, e quem filtra agenda falsa continua sendo a pessoa que
 * aprova no painel, não a senha.
 *
 * Devolver um token aqui seria o erro sutil que desmonta a contingência
 * inteira: com sessão, o agendamento nasceria firme, e bastaria inventar um
 * número e uma senha para entrar na agenda sem passar por ninguém.
 *
 * ## Só para telefone SEM conta
 *
 * Telefone que já tem cadastro é recusado, sempre — inclusive quando a conta
 * não tem senha nenhuma. Deixar criar senha ali entregaria a conta (histórico,
 * pacotes, créditos pagos) para quem chegasse primeiro, já que sem OTP não há
 * como provar que quem digita é o dono. Esse caso é resolvido à mão: o admin
 * define a senha depois de confirmar a identidade por outros meios.
 *
 * O motor de hash é o mesmo do login de staff (`infrastructure/senha.ts`,
 * scrypt com sal por senha). Não existe uma segunda implementação de senha
 * neste sistema.
 */
@Injectable()
export class CriarContaComSenhaClienteUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: CriarContaComSenhaClienteInput): Promise<void> {
    let telefone: Telefone;
    try {
      telefone = Telefone.de(input.telefone);
    } catch (erro) {
      if (erro instanceof InvarianteVioladaError) {
        throw new BadRequestException('Telefone inválido');
      }
      throw erro;
    }

    // A MESMA regra do front (`packages/contracts`), aplicada aqui porque
    // validação só no front é um curl de distância.
    const problema = validarSenhaDeCliente(input.senha, telefone.e164);
    if (!problema.ok) {
      throw new BadRequestException(problema.erro!);
    }

    await this.uow.transacao(async (repos) => {
      const existente = await repos.clientes.porTelefone(input.companyId, telefone);
      if (existente) {
        // Mensagem igual para "já tem senha" e "não tem senha": o funil já sabe
        // qual é o caso (perguntou antes), e a resposta desta rota não precisa
        // dizer mais do que "não é por aqui". A corrida entre a consulta e este
        // POST cai aqui, e é justamente o caso que não pode virar sequestro de
        // conta por acidente.
        throw new ConflictException(
          'Já existe uma conta para este número. Fale com a barbearia para ativar seu acesso.',
        );
      }

      const cliente = Cliente.criar({
        id: randomUUID(),
        companyId: input.companyId,
        nome: input.nome,
        telefone,
      });
      cliente.definirSenha(hashSenha(input.senha));
      await repos.clientes.salvar(cliente);
    });
  }
}
