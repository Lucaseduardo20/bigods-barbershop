import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Telefone } from '../../../shared/domain/telefone';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import { verificaSenha } from '../infrastructure/senha';
import { ClienteSessaoService } from '../infrastructure/cliente-sessao.service';

export interface LoginComSenhaClienteInput {
  companyId: string;
  telefone: string;
  senha: string;
}

export interface LoginComSenhaClienteOutput {
  token: string;
  cliente: { id: string; nome: string; telefone: string };
}

/**
 * Hash descartável com o formato real, para gastar o mesmo scrypt quando não há
 * cliente ou não há senha definida.
 *
 * Sem isto, "telefone que não existe" responderia visivelmente mais rápido que
 * "senha errada", e o tempo de resposta viraria um oráculo de quem é cliente da
 * barbearia. A resposta já é a mesma; o tempo também precisa ser.
 */
const HASH_FANTASMA =
  '00000000000000000000000000000000:' +
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * ★★ LOGIN DO CLIENTE POR SENHA (2026-08-28) — o caminho de todo dia, sem SMS.
 *
 * Nasceu de um incidente: o SMS de verificação parou de chegar de forma
 * confiável (rota do provedor, não código), e o cliente que pagou um pacote
 * ficou trancado para fora da própria conta. Com senha, entrar não depende de
 * SMS nenhum.
 *
 * Hoje quem define a senha é o ADMIN, pela tela de Clientes, e passa ao cliente
 * por WhatsApp. É deliberadamente simples: o autosserviço de "definir minha
 * senha" e o "esqueci a senha" dependem de provar posse do telefone, que é
 * exatamente o que está quebrado.
 *
 * ## Resposta neutra, sempre
 *
 * Telefone inexistente, cliente sem senha definida e senha errada dão
 * exatamente a MESMA resposta. Diferenciar transformaria a tela de login numa
 * consulta de "fulano é cliente daqui?" — que, numa barbearia de bairro, é
 * informação sobre a vida de pessoas reais.
 */
@Injectable()
export class LoginComSenhaClienteUseCase {
  constructor(
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    private readonly sessao: ClienteSessaoService,
  ) {}

  async executar(input: LoginComSenhaClienteInput): Promise<LoginComSenhaClienteOutput> {
    const recusar = () => new UnauthorizedException('Telefone ou senha incorretos.');

    let telefone: Telefone;
    try {
      telefone = Telefone.de(input.telefone);
    } catch (erro) {
      // Número malformado também é "telefone ou senha incorretos": dizer
      // "telefone inválido" aqui não ajuda quem errou a senha e ajuda quem
      // está varrendo formatos.
      if (erro instanceof InvarianteVioladaError) throw recusar();
      throw erro;
    }

    const cliente = await this.clientes.porTelefone(input.companyId, telefone);
    const hash = cliente?.senhaHash ?? null;

    // Gasta o scrypt mesmo quando não há o que conferir — ver HASH_FANTASMA.
    const confere = verificaSenha(input.senha, hash ?? HASH_FANTASMA);
    if (!cliente || !hash || !confere) {
      throw recusar();
    }

    const token = this.sessao.emitir({
      clienteId: cliente.id,
      companyId: cliente.companyId,
      // Cliente que ainda não passou por OTP nenhum não tem `cognitoSub`; o
      // próprio id serve de `sub` da sessão, que é opaco para o resto do
      // sistema. Com a contingência ligada, este é o caso comum.
      sub: cliente.cognitoSub ?? cliente.id,
    });
    return {
      token,
      cliente: { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone.e164 },
    };
  }
}
