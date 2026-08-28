import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StatusPagamento } from '@bigods/contracts';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import {
  CONFIG_REEMBOLSO,
  ConfigReembolso,
  instanteDaExecucao,
  validarPrazoDias,
} from '../../../shared/config/reembolso';
import { PAYMENT_GATEWAY, PaymentGateway } from '../../payments/domain/payment-gateway';

export interface AgendarReembolsoInput {
  solicitacaoId: string;
  companyId: string;
  /** Ausente = prazo padrão do deploy. `0` = executar agora. */
  prazoDias?: number;
  agora?: Date;
}

export interface AgendarReembolsoResultado {
  agendadaPara: string;
  /** `true` quando o prazo é zero e a execução acontece no próximo tick do job. */
  imediato: boolean;
}

/**
 * Agenda a execução do estorno pelo gateway.
 *
 * ## Uma transição, três botões
 *
 * A tela do admin tem "agendar (31 dias)", "antecipar" e "tentar de novo". As três
 * são a mesma coisa — definir *quando* executar — e por isso são o mesmo caso de
 * uso, com `prazoDias` diferente. Três casos de uso quase idênticos seriam três
 * lugares para a regra divergir; o agregado (`SolicitacaoDeReembolso.agendar`) é
 * quem sabe de quais estados se pode sair.
 *
 * ## Por que exige pagamento ONLINE
 *
 * Estornar pelo gateway precisa de uma transação no gateway. Um pacote pago no
 * balcão (dinheiro, maquininha) não tem uma — e agendar ali criaria uma linha que o
 * job varreria para sempre sem nunca ter o que executar. Esses seguem no caminho
 * manual de sempre: o admin devolve e registra em `POST .../confirmar`.
 *
 * A checagem acontece AQUI, na aplicação, e não no agregado: só esta camada pode
 * ler `IntencaoDePagamento`, que é outro agregado (§2.3).
 *
 * ## O que este caso de uso NÃO faz
 *
 * Não chama o gateway. Nem quando `prazoDias = 0`. A execução é sempre do job —
 * um único caminho de execução significa um único lugar onde a retentativa, a
 * chave de idempotência e a contagem de tentativas existem. "Executar agora"
 * agenda para agora e o próximo tick (10 min) pega; a alternativa seria duplicar o
 * protocolo de três tempos aqui.
 */
@Injectable()
export class AgendarReembolsoUseCase {
  private readonly logger = new Logger(AgendarReembolsoUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONFIG_REEMBOLSO) private readonly config: ConfigReembolso,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async executar(input: AgendarReembolsoInput): Promise<AgendarReembolsoResultado> {
    const agora = input.agora ?? new Date();
    // Valida ANTES da transação: um prazo inválido é erro de borda, e não vale
    // abrir transação para descobrir isso.
    const prazoDias = validarPrazoDias(input.prazoDias, this.config.prazoDiasPadrao);
    const agendadaPara = instanteDaExecucao(agora, prazoDias);

    await this.uow.transacao(async (repos) => {
      const solicitacao = await repos.solicitacoesReembolso.porId(input.solicitacaoId);
      if (!solicitacao || solicitacao.companyId !== input.companyId) {
        throw new NotFoundException('Solicitação de reembolso não encontrada');
      }

      const intencao = await repos.intencoesDePagamento.porReferenciaVendaDePacote(
        solicitacao.vendaDePacoteId,
      );
      const pagaOnline =
        intencao !== null &&
        intencao.status === StatusPagamento.PAGO &&
        intencao.gatewayId !== null;
      if (!pagaOnline) {
        throw new BadRequestException(
          'Este pacote não foi pago online, então não há transação para estornar pelo gateway. ' +
            'Devolva o valor por fora e registre em "Confirmar reembolso".',
        );
      }
      if (!this.gateway.suportaEstorno) {
        throw new BadRequestException(
          'O meio de pagamento configurado neste momento não executa estorno automático. ' +
            'Devolva o valor por fora e registre em "Confirmar reembolso".',
        );
      }

      solicitacao.agendar(agendadaPara);
      await repos.solicitacoesReembolso.salvar(solicitacao);
    });

    this.logger.log(
      `Estorno da solicitação ${input.solicitacaoId} agendado para ${agendadaPara.toISOString()} ` +
        `(${prazoDias} dia(s)).`,
    );
    return { agendadaPara: agendadaPara.toISOString(), imediato: prazoDias === 0 };
  }
}

/**
 * Desfaz o agendamento: volta a solicitação para PENDENTE.
 *
 * Existe porque `marcarReembolsada` recusa AGENDADO de propósito — devolver à mão
 * uma solicitação com execução a caminho pagaria duas vezes. Esta é a saída
 * explícita, e ela NÃO desiste de devolver: o saldo do pacote continua reservado,
 * só o *quando* e o *como* voltam a ser decisão do admin.
 */
@Injectable()
export class CancelarAgendamentoDeReembolsoUseCase {
  private readonly logger = new Logger(CancelarAgendamentoDeReembolsoUseCase.name);

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async executar(input: { solicitacaoId: string; companyId: string }): Promise<void> {
    await this.uow.transacao(async (repos) => {
      const solicitacao = await repos.solicitacoesReembolso.porId(input.solicitacaoId);
      if (!solicitacao || solicitacao.companyId !== input.companyId) {
        throw new NotFoundException('Solicitação de reembolso não encontrada');
      }
      solicitacao.cancelarAgendamento();
      await repos.solicitacoesReembolso.salvar(solicitacao);
    });
    this.logger.log(
      `Agendamento da solicitação ${input.solicitacaoId} cancelado — volta para a fila do admin. ` +
        'O saldo do pacote segue reservado.',
    );
  }
}
