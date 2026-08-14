import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { HorariosDisponiveisDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { horaLocalHHmm, limitesDoDiaCivil } from '../../../shared/domain/calendario';

/**
 * Passo do grid de horários oferecidos (minutos). A granularidade da listagem
 * de horários livres é UMA PROJEÇÃO (DOMAIN.md §2.1) — pode ser ajustada
 * livremente; se ela errar por corrida, a escrita (invariante de domínio +
 * constraint EXCLUDE) rejeita. Não é regra de domínio.
 */
// DECISAO_PENDENTE: granularidade do grid de horários (15 min) não está na spec — confirmar com o negócio.
const PASSO_MINUTOS = 15;

/**
 * Projeção de leitura: horários de início livres para um barbeiro num dia,
 * dado o conjunto de serviços escolhidos (a duração total é a soma). Livre =
 * cabe inteiramente numa janela de `DisponibilidadeBarbeiro` e não se sobrepõe
 * a nenhum `Atendimento` AGENDADO (mesmo critério da invariante e da EXCLUDE).
 *
 * Fonte de verdade continua sendo a escrita — aqui é só o que exibir ao cliente.
 */
@Injectable()
export class HorariosDisponiveisQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY)
    private readonly parametros: ParametrosDaEmpresaRepository,
  ) {}

  async disponiveis(params: {
    companyId: string;
    barbeiroId: string;
    data: string; // YYYY-MM-DD, dia civil local
    servicoIds: string[];
    agora?: Date;
  }): Promise<HorariosDisponiveisDTO> {
    if (params.servicoIds.length === 0) {
      throw new BadRequestException('Informe ao menos um serviço');
    }
    // timezone() também valida que a empresa existe (sem fallback de tenant, §2.4)
    const tz = await this.parametros.timezone(params.companyId);
    const agora = params.agora ?? new Date();

    const servicos = await this.prisma.servico.findMany({
      where: { id: { in: params.servicoIds }, companyId: params.companyId },
    });
    if (servicos.length !== new Set(params.servicoIds).size) {
      throw new NotFoundException('Serviço inexistente');
    }
    const inativo = servicos.find((s) => !s.ativo);
    if (inativo) {
      throw new BadRequestException(`Serviço ${inativo.nome} está inativo`);
    }
    const duracaoTotalMs =
      servicos.reduce((acc, s) => acc + s.duracaoMinutos, 0) * 60_000;

    const { inicio: diaInicio, fimExclusivo: diaFim } = limitesDoDiaCivil(params.data, tz);

    const [janelas, ocupados] = await Promise.all([
      this.prisma.disponibilidade.findMany({
        where: { barbeiroId: params.barbeiroId, data: params.data },
        orderBy: { inicio: 'asc' },
      }),
      this.prisma.atendimento.findMany({
        where: {
          barbeiroId: params.barbeiroId,
          inicio: { lt: diaFim },
          fim: { gt: diaInicio },
          OR: [
            { status: 'AGENDADO' },
            // RESERVADO ocupa o horário igual a AGENDADO (mesmo critério do
            // domínio/EXCLUDE) — MAS uma reserva cujo prazo já passou não
            // pode aparecer como ocupada aqui, mesmo que ainda não tenha
            // sido lazy-expirada em `RESERVA_EXPIRADA` por ninguém (sessão
            // de OTP+reserva, Problema 2: "horário expirado não aparece
            // como ocupado na projeção pública").
            { status: 'RESERVADO', reservaOnlineExpiraEm: { gt: agora } },
          ],
        },
        select: { inicio: true, fim: true },
      }),
    ]);

    const passoMs = PASSO_MINUTOS * 60_000;
    const horarios: HorariosDisponiveisDTO['horarios'] = [];

    for (const janela of janelas) {
      // Intervalo semiaberto [inicio, fim): o slot cabe se início+duração <= fim.
      const ultimoInicio = janela.fim.getTime() - duracaoTotalMs;
      for (let t = janela.inicio.getTime(); t <= ultimoInicio; t += passoMs) {
        const slotInicio = t;
        const slotFim = t + duracaoTotalMs;
        if (slotInicio <= agora.getTime()) continue; // não oferecer horário passado
        const conflita = ocupados.some(
          (o) => slotInicio < o.fim.getTime() && o.inicio.getTime() < slotFim,
        );
        if (conflita) continue;
        const instante = new Date(slotInicio);
        horarios.push({
          horaInicio: horaLocalHHmm(instante, tz),
          inicioIso: instante.toISOString(),
        });
      }
    }

    horarios.sort((a, b) => a.inicioIso.localeCompare(b.inicioIso));
    return { data: params.data, horarios };
  }
}
