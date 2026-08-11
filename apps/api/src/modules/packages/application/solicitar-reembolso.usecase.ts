import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../shared/application/unit-of-work';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../domain/parametros-da-empresa.repository';
import { fimDoDiaCivilMaisDias } from '../../../shared/domain/calendario';
import { InvarianteVioladaError } from '../../../shared/errors/domain-error';
import { PRAZO_REEMBOLSO_DIAS, SolicitacaoDeReembolso } from '../domain/solicitacao-de-reembolso.aggregate';

export interface SolicitarReembolsoInput {
  vendaDePacoteId: string;
  companyId: string;
  clienteId: string;
  hoje: Date;
}

export interface SolicitarReembolsoOutput {
  solicitacaoId: string;
  valorCentavos: number;
}

/**
 * FASE 4b (sessão-E, §8.7): cliente pede reembolso MANUAL do saldo residual
 * de um pacote. Reserva o saldo no MOMENTO do pedido (`VendaDePacote.
 * reservarSaldoParaReembolso`) — não espera confirmação do admin — o que
 * estruturalmente impede abater (FASE 4a) o mesmo dinheiro depois: uma vez
 * reservado, `saldoResidual` fica zerado. O prazo de 45 dias conta da
 * expiração mais recente que alimentou o saldo (`saldoResidualDesde`); se
 * nunca houve expiração registrada (não deveria acontecer com saldo > 0),
 * cai no fallback de `compradoEm`.
 */
@Injectable()
export class SolicitarReembolsoUseCase {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  async executar(input: SolicitarReembolsoInput): Promise<SolicitarReembolsoOutput> {
    const tz = await this.parametros.timezone(input.companyId);
    return this.uow.transacao(async (repos) => {
      const venda = await repos.vendasDePacote.porId(input.vendaDePacoteId);
      if (!venda || venda.companyId !== input.companyId) {
        throw new NotFoundException('Pacote não encontrado');
      }
      if (venda.clienteId !== input.clienteId) {
        throw new ForbiddenException('Este pacote não pertence a você');
      }

      const ancoraPrazo = venda.saldoResidualDesde ?? venda.compradoEm;
      const prazoLimiteEm = fimDoDiaCivilMaisDias(ancoraPrazo, PRAZO_REEMBOLSO_DIAS, tz);
      if (input.hoje.getTime() > prazoLimiteEm.getTime()) {
        throw new InvarianteVioladaError(
          'Prazo de 45 dias para pedir reembolso deste saldo já passou. Entre em contato pelo WhatsApp da barbearia.',
        );
      }

      const valorReservado = venda.reservarSaldoParaReembolso();
      const solicitacao = SolicitacaoDeReembolso.criar({
        id: crypto.randomUUID(),
        companyId: input.companyId,
        vendaDePacoteId: venda.id,
        clienteId: input.clienteId,
        valor: valorReservado,
        prazoLimiteEm,
        hoje: input.hoje,
      });

      await repos.vendasDePacote.salvar(venda);
      await repos.solicitacoesReembolso.salvar(solicitacao);

      return { solicitacaoId: solicitacao.id, valorCentavos: solicitacao.valor.centavos };
    });
  }
}
