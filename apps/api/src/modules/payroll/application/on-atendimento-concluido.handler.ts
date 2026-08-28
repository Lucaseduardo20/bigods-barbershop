import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import {
  LANCAMENTO_COMISSAO_REPOSITORY,
  LancamentoComissaoRepository,
} from '../domain/lancamento-comissao.repository';
import { BARBEIRO_REPOSITORY, BarbeiroRepository } from '../../staff/domain/barbeiro.repository';
import { AtendimentoConcluido } from '../../scheduling/domain/atendimento.events';
import { lancamentosDoAtendimentoConcluido } from '../domain/lancamentos-do-atendimento';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';

/**
 * Payroll (§2.3): a conclusão do atendimento emite evento; este handler
 * cria os lançamentos imutáveis no ledger. Para SERVIÇOS, valorBase =
 * valorCobrado do item (já é o rateado quando a origem é pacote) e o
 * percentual vem da matriz barbeiro×serviço. Para PRODUTOS (item 4a da
 * sessão 2026-07-16, add-on vendido junto do atendimento — inclui o que entrou
 * pelo order-bump do funil), valorBase = unitário×quantidade e o percentual é a
 * taxa ÚNICA DA EMPRESA (2026-08-19, decisão dos sócios), não a do barbeiro:
 * produto é revenda. Ver DOMAIN.md §3.9.1.
 */
@Injectable()
export class OnAtendimentoConcluidoHandler {
  private readonly logger = new Logger(OnAtendimentoConcluidoHandler.name);

  constructor(
    @Inject(LANCAMENTO_COMISSAO_REPOSITORY)
    private readonly lancamentos: LancamentoComissaoRepository,
    @Inject(BARBEIRO_REPOSITORY) private readonly barbeiros: BarbeiroRepository,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  @OnEvent('AtendimentoConcluido')
  async handle(evento: AtendimentoConcluido): Promise<void> {
    // Idempotência: reprocessar o mesmo evento não duplica lançamentos
    const existentes = await this.lancamentos.porAtendimento(evento.atendimentoId);
    if (existentes.length > 0) return;

    const barbeiro = await this.barbeiros.porId(evento.barbeiroId);
    if (!barbeiro) {
      this.logger.error(`Barbeiro ${evento.barbeiroId} não encontrado — comissão não gerada`);
      return;
    }

    // Taxa lida AGORA, na conclusão, e congelada em cada lançamento (§3.5):
    // mudar a taxa depois não mexe em nada já lançado. Só consulta se houver
    // produto — atendimento só de serviço é o caso comum e não paga essa ida ao
    // banco.
    const taxaDeProduto = evento.produtos.length
      ? await this.parametros.comissaoProdutos(evento.companyId)
      : null;

    // A conta em si mora em `lancamentos-do-atendimento.ts`, compartilhada com
    // a CORREÇÃO de barbeiro (2026-08-27): quando a comissão foi lançada para
    // quem não atendeu, ela nasce de novo no nome de quem atendeu, pela taxa
    // dele — pela MESMA conta. Duas implementações divergiriam, e o sintoma
    // seria dinheiro diferente dependendo do caminho.
    const lancamentos = lancamentosDoAtendimentoConcluido({
      companyId: evento.companyId,
      atendimentoId: evento.atendimentoId,
      barbeiro,
      itens: evento.itens.map((i) => ({
        servicoId: i.servicoId,
        valorCobradoCentavos: i.valorCobradoCentavos,
      })),
      produtos: evento.produtos.map((p) => ({
        produtoId: p.produtoId,
        valorUnitarioCentavos: p.valorUnitarioCentavos,
        quantidade: p.quantidade,
      })),
      taxaDeProduto,
      caixinhaCentavos: evento.caixinhaCentavos,
      descontoConcedidoCentavos: evento.descontoConcedidoCentavos,
      ocorridoEm: evento.ocorridoEm,
      novoId: randomUUID,
    });

    for (const lancamento of lancamentos) {
      await this.lancamentos.salvar(lancamento);
    }
  }
}
