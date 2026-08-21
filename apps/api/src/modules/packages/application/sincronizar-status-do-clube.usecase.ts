import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StatusDoClube, TipoEventoClube } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { ClubeQueryService } from '../infrastructure/clube-query.service';
import { eventoDaTransicao } from '../domain/status-do-clube';

/**
 * RECONCILIADOR do log do Bigod's Club (2026-08-21).
 *
 * Chamado depois de qualquer fato que POSSA mudar o status (pacote pago, crédito
 * consumido/expirado, avulso marcado, cancelamento que devolve crédito). Ele
 * não sabe qual foi a transição: calcula o status atual, compara com o último
 * status registrado no log e grava **só se mudou**.
 *
 * ## Por que reconciliar em vez de gravar em cada ponto
 *
 * Detectar a transição em cada call site exigiria que cada um soubesse o estado
 * anterior — e um esquecido geraria evento duplicado ou nenhum. Reconciliar dá
 * **idempotência de graça**: rodar duas vezes seguidas não grava duas linhas,
 * porque na segunda o status já é igual ao último registrado.
 *
 * ## O que isso significa quando algo falha
 *
 * Se nenhum evento disparar a reconciliação, o log ATRASA — a linha aparece na
 * próxima vez que algo acontecer com aquele cliente. O status mostrado ao
 * cliente NUNCA fica errado, porque é calculado na leitura e não sai daqui.
 * Falha ao gravar o log é logada e engolida: o log é auditoria, e derrubar a
 * compra de um pacote porque a linha de histórico não entrou seria pior.
 */
@Injectable()
export class SincronizarStatusDoClubeUseCase {
  private readonly logger = new Logger(SincronizarStatusDoClubeUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ClubeQueryService) private readonly clube: ClubeQueryService,
  ) {}

  async executar(params: {
    companyId: string;
    clienteId: string;
    /** Texto curto do que causou — só auditoria humana. */
    causa: string;
  }): Promise<TipoEventoClube | null> {
    try {
      const [statusAtual, ultimo] = await Promise.all([
        this.clube.statusDe(params.companyId, params.clienteId),
        this.prisma.eventoDoClube.findFirst({
          where: { clienteId: params.clienteId },
          orderBy: { ocorridoEm: 'desc' },
        }),
      ]);

      // Sem log, o ponto de partida é NAO_MEMBRO: é o estado de quem nunca
      // apareceu no clube. Assim a primeira transição real é sempre registrada.
      const anterior = ultimo
        ? (StatusDoClube[ultimo.statusNovo as keyof typeof StatusDoClube] ?? StatusDoClube.NAO_MEMBRO)
        : StatusDoClube.NAO_MEMBRO;

      const tipo = eventoDaTransicao({
        anterior,
        novo: statusAtual,
        jaFoiMembro: ultimo !== null,
      });
      if (!tipo) return null;

      await this.prisma.eventoDoClube.create({
        data: {
          id: randomUUID(),
          companyId: params.companyId,
          clienteId: params.clienteId,
          tipo,
          statusAnterior: anterior,
          statusNovo: statusAtual,
          causa: params.causa,
          ocorridoEm: new Date(),
        },
      });
      return tipo;
    } catch (e) {
      // Nunca derruba o fluxo que chamou: o log é histórico, não a operação.
      this.logger.error(
        `Falha ao reconciliar status do clube do cliente ${params.clienteId}: ${(e as Error).message}`,
      );
      return null;
    }
  }
}
