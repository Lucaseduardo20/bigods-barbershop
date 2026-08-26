import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ATENDIMENTO_REPOSITORY, AtendimentoRepository } from '../domain/atendimento.repository';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { precoDeReferencia } from '../../packages/domain/precificacao-pacote';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../../payments/domain/intencao-de-pagamento.repository';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { autorizarDonoOuAdmin } from './concluir-atendimento.usecase';
import { motivoParaNaoMexerNoValor } from './editar-comanda.usecase';

export interface AdicionarItemAtendimentoInput {
  atendimentoId: string;
  servicoId: string;
  usuario: UsuarioAutenticado;
}

/**
 * Item 3 da sessão 2026-07-16 (walk-in add-on): cliente agendou um corte, na
 * cadeira decidiu fazer a barba também. Adiciona um serviço avulso a um
 * Atendimento AGENDADO, ANTES de concluir. Preço = snapshot do preço DO
 * BARBEIRO vigente no momento (§3.2.2 — preço por barbeiro vale geral,
 * DECISOES_PENDENTES #18). Sem transação multi-agregado: um único aggregate
 * mutado (Atendimento).
 */
@Injectable()
export class AdicionarItemAtendimentoUseCase {
  constructor(
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY)
    private readonly intencoes: IntencaoDePagamentoRepository,
  ) {}

  async executar(input: AdicionarItemAtendimentoInput): Promise<void> {
    const atendimento = await this.atendimentos.porId(input.atendimentoId);
    if (!atendimento || atendimento.companyId !== input.usuario.companyId) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    autorizarDonoOuAdmin(atendimento.barbeiroId, input.usuario);

    const servico = await this.servicos.porId(input.servicoId);
    if (!servico || !servico.ativo) {
      throw new BadRequestException('Serviço inexistente ou inativo');
    }
    const barbeiro = await this.barbeiros.porId(atendimento.barbeiroId);
    if (!barbeiro) {
      throw new NotFoundException('Barbeiro não encontrado');
    }

    atendimento.adicionarItem(servico.id, precoDeReferencia(servico, barbeiro), servico.duracao, barbeiro);

    // FASE 1 (2026-08-25): entrar um serviço muda o preço dos OUTROS — a escada
    // do desconto progressivo depende de quantos itens a comanda tem. Até aqui
    // o add-on entrava pelo preço cheio e os itens antigos ficavam com o
    // desconto de uma composição que já não existia; o total não batia com o
    // que o cliente veria se tivesse agendado os dois de uma vez.
    //
    // Com dinheiro já recebido (pago online / saldo abatido), NÃO reprecifica:
    // adicionar continua liberado — o adicional é cobrado na hora — mas o preço
    // do que já foi pago não muda embaixo de um pagamento fechado.
    const motivo = await motivoParaNaoMexerNoValor(atendimento, this.intencoes);
    if (!motivo) {
      atendimento.reprecificarAvulsos(await this.parametros.tabelaDeDesconto(atendimento.companyId));
    }

    await this.atendimentos.salvar(atendimento);
  }
}
