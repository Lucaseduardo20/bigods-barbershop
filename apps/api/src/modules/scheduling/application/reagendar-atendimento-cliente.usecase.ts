import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrigemAtendimento, StatusAtendimento } from '@bigods/contracts';
import { ATENDIMENTO_REPOSITORY, AtendimentoRepository } from '../domain/atendimento.repository';
import { CLIENTE_REPOSITORY, ClienteRepository } from '../../customers/domain/cliente.repository';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { AgendarAvulsoUseCase } from './agendar-avulso.usecase';
import { AgendarComCreditoUseCase } from './agendar-com-credito.usecase';
import { CancelarAtendimentoClienteUseCase } from './cancelar-atendimento-cliente.usecase';

export interface ReagendarAtendimentoClienteInput {
  atendimentoId: string;
  companyId: string;
  clienteId: string;
  novoInicio: Date;
}

export interface ReagendarAtendimentoClienteOutput {
  novoAtendimentoId: string;
}

/**
 * FASE 3 (sessão-E, §8.6): "reagendar" pelo cockpit — pro cliente, PARECE
 * mover o horário de um agendamento existente (mesmo serviço/barbeiro,
 * nova data/hora); no sistema, continua sendo cancelar + criar novo
 * (§4.1 — "estados finais não transicionam"), SEM reinventar essa regra.
 * Orquestra os casos de uso que já existem, cada um com sua própria
 * transação — não duplica nenhuma regra de domínio de agendamento/cancelamento.
 *
 * ORDEM importa e é DIFERENTE por origem, de propósito:
 * - CREDITO_PACOTE: precisa CANCELAR primeiro — o item do pacote só sai de
 *   AGENDADO (preso ao atendimento antigo) quando o cancelamento antecipado
 *   o libera (mesmo handler de §4.2 já usado no cancelamento comum). Só
 *   depois disso o item pode ser consumido de novo pra o novo horário. Se o
 *   novo horário falhar (conflito/disponibilidade), o crédito já está de
 *   volta em DISPONIVEL — o cliente não perde nada, só precisa tentar de
 *   novo com outro horário.
 * - AVULSO: cria o NOVO atendimento primeiro (valida que o novo horário é
 *   possível) e só cancela o antigo se isso funcionar — evita a janela onde
 *   o cliente fica sem o antigo E sem o novo se o horário escolhido não
 *   estiver mais disponível.
 */
@Injectable()
export class ReagendarAtendimentoClienteUseCase {
  constructor(
    @Inject(ATENDIMENTO_REPOSITORY) private readonly atendimentos: AtendimentoRepository,
    @Inject(CLIENTE_REPOSITORY) private readonly clientes: ClienteRepository,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendas: VendaDePacoteRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
    private readonly agendarAvulso: AgendarAvulsoUseCase,
    private readonly agendarComCredito: AgendarComCreditoUseCase,
    private readonly cancelarCliente: CancelarAtendimentoClienteUseCase,
  ) {}

  async executar(input: ReagendarAtendimentoClienteInput): Promise<ReagendarAtendimentoClienteOutput> {
    const antigo = await this.atendimentos.porId(input.atendimentoId);
    if (!antigo || antigo.companyId !== input.companyId) {
      throw new NotFoundException('Agendamento não encontrado');
    }
    if (antigo.clienteId !== input.clienteId) {
      throw new ForbiddenException('Este agendamento não pertence a você');
    }
    if (antigo.status !== StatusAtendimento.AGENDADO) {
      throw new InvarianteVioladaError('Só é possível reagendar um agendamento que ainda está agendado');
    }

    const janelaHoras = await this.parametros.janelaReagendamentoHoras(input.companyId);
    const faltamMs = antigo.intervalo.inicio.getTime() - Date.now();
    if (faltamMs < janelaHoras * 60 * 60 * 1000) {
      throw new InvarianteVioladaError(
        `Reagendamento pelo app só é possível até ${janelaHoras}h antes do horário. Entre em contato pelo WhatsApp da barbearia para reagendar agora.`,
      );
    }

    const barbeiroId = antigo.barbeiroId;
    const servicoIds = antigo.itens.map((i) => i.servicoId);

    if (antigo.origem === OrigemAtendimento.CREDITO_PACOTE) {
      const itemDoPacoteId = antigo.itens[0]?.itemDoPacoteId;
      if (!itemDoPacoteId) {
        throw new InvarianteVioladaError('Agendamento de crédito sem item de pacote associado');
      }
      const venda = await this.vendas.porItemId(itemDoPacoteId);
      if (!venda) {
        throw new NotFoundException('Pacote do crédito não encontrado');
      }
      // Cancela primeiro — libera o item (sem falta, cancelamento antecipado) pra poder reagendar.
      await this.cancelarCliente.executar({
        atendimentoId: input.atendimentoId,
        companyId: input.companyId,
        clienteId: input.clienteId,
      });
      const resultado = await this.agendarComCredito.executar({
        companyId: input.companyId,
        vendaId: venda.id,
        itemId: itemDoPacoteId,
        barbeiroId,
        inicio: input.novoInicio,
      });
      return { novoAtendimentoId: resultado.atendimentoId };
    }

    // AVULSO: cria o novo primeiro — só cancela o antigo se o novo horário for válido.
    const cliente = await this.clientes.porId(input.clienteId);
    if (!cliente) {
      throw new NotFoundException('Cliente não encontrado');
    }
    const resultado = await this.agendarAvulso.executar({
      companyId: input.companyId,
      barbeiroId,
      servicoIds,
      inicio: input.novoInicio,
      cliente: { nome: cliente.nome, telefone: cliente.telefone.e164 },
      gerarCobranca: false,
      // Sessão de OTP+reserva (Problema 3): reagendar é uma TROCA (cria o
      // novo antes de cancelar o antigo, ver comentário da classe) — sem
      // isso, o cliente no limite de 3 presenciais seria recusado ao tentar
      // mover um dos 3 que ele já tem, porque o antigo ainda contaria no
      // instante da checagem.
      aplicarCotaPresencial: false,
      // DECISAO_PENDENTE: se o agendamento antigo foi pago online (PIX), o
      // valor já pago fica vinculado à IntencaoDePagamento do atendimento
      // ANTIGO (agora cancelado) — não é re-emitido nem estornado
      // automaticamente aqui. Reagendar nunca gera nova cobrança.
    });
    await this.cancelarCliente.executar({
      atendimentoId: input.atendimentoId,
      companyId: input.companyId,
      clienteId: input.clienteId,
    });
    return { novoAtendimentoId: resultado.atendimentoId };
  }
}
