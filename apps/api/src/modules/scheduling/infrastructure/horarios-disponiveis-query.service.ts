import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DiasDisponiveisDTO, HorariosDisponiveisDTO } from '@bigods/contracts';
import { somarDias } from '../domain/regra-janela-agendamento';
import { diaCivilChave, diaDaSemanaCivil } from '../../../shared/domain/calendario';
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
 * ★★ Os status que OCUPAM o horário na PROJEÇÃO de leitura (2026-09-04).
 *
 * Uma lista só, usada nas cinco consultas deste arquivo. Antes cada uma tinha a
 * sua cópia, e foi assim que `AGUARDANDO_APROVACAO` (contingência de OTP,
 * §8.17) entrou na EXCLUDE e no domínio mas não aqui: a agenda continuava
 * oferecendo o horário de um pedido pendente, e o cliente seguinte só descobria
 * ao confirmar — com erro de banco no fim do funil, que é o pior lugar
 * possível para descobrir qualquer coisa.
 *
 * O critério é o mesmo da invariante e da constraint: se a escrita vai recusar,
 * a leitura não pode oferecer.
 *
 * - `AGENDADO` — firme.
 * - `CONCLUSAO_PENDENTE` (2026-08-20) — a recusa devolve para AGENDADO, então o
 *   horário não pode ter sido vendido a outro cliente no meio.
 * - `AGUARDANDO_APROVACAO` (2026-09-04) — idem: a aprovação o torna firme, e
 *   até lá o horário é de quem pediu.
 * - `RESERVADO` só enquanto o prazo não venceu — reserva vencida não ocupa
 *   nada, mesmo que ninguém a tenha expirado ainda (lazy).
 */
function ocupamOHorario(agora: Date) {
  return [
    { status: 'AGENDADO' as const },
    { status: 'CONCLUSAO_PENDENTE' as const },
    { status: 'AGUARDANDO_APROVACAO' as const },
    { status: 'RESERVADO' as const, reservaOnlineExpiraEm: { gt: agora } },
  ];
}

/**
 * Projeção de leitura: horários de início livres para um barbeiro num dia,
 * dado o conjunto de serviços escolhidos (a duração total é a soma). Livre =
 * cabe inteiramente numa janela de `DisponibilidadeBarbeiro` e não se sobrepõe
 * a nenhum `Atendimento` AGENDADO (mesmo critério da invariante e da EXCLUDE).
 *
 * Fonte de verdade continua sendo a escrita — aqui é só o que exibir ao cliente.
 *
 * ## Dias permitidos do pacote (2026-08-28)
 *
 * Quando a consulta é para gastar um crédito, `diasPermitidos` chega com o
 * SNAPSHOT da venda e os dias fora dele simplesmente NÃO são oferecidos. É de
 * propósito que não exista mensagem de erro no meio do fluxo: o cliente escolhe
 * entre o que dá, em vez de escolher e ser recusado. A explicação do porquê
 * ("Válido de segunda a quinta") fica na tela, ANTES da escolha.
 *
 * O bloqueio real continua na escrita (`VendaDePacote.agendarItem`) — isto aqui
 * é leitura, e leitura não guarda regra.
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
    /** Snapshot da venda quando a consulta é para gastar crédito (2026-08-28). */
    diasPermitidos?: number[];
    agora?: Date;
  }): Promise<HorariosDisponiveisDTO> {
    if (params.servicoIds.length === 0) {
      throw new BadRequestException('Informe ao menos um serviço');
    }
    // timezone() também valida que a empresa existe (sem fallback de tenant, §2.4)
    const tz = await this.parametros.timezone(params.companyId);
    const agora = params.agora ?? new Date();
    // Dia bloqueado pelo pacote: some inteiro, sem erro e sem query.
    if (this.diaBloqueado(params.data, params.diasPermitidos)) {
      return { data: params.data, horarios: [] };
    }

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
          OR: ocupamOHorario(agora),
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

  /**
   * Quais dias de um PERÍODO têm ao menos um horário livre — o que o funil usa
   * para riscar as datas em que não adianta clicar.
   *
   * Custo é o ponto central aqui: a versão ingênua seria chamar `disponiveis`
   * uma vez por dia (30 requisições e 60 queries para pintar um mês). Esta faz
   * **duas** queries no total, uma para as janelas do período e outra para os
   * atendimentos do período, e resolve o resto em memória — e ainda para no
   * PRIMEIRO slot livre de cada dia, porque a resposta é booleana.
   */
  async diasComHorario(params: {
    companyId: string;
    barbeiroId: string;
    de: string; // YYYY-MM-DD (inclusivo), dia civil local
    ate: string; // YYYY-MM-DD (inclusivo)
    servicoIds: string[];
    /** Snapshot da venda quando a consulta é para gastar crédito (2026-08-28). */
    diasPermitidos?: number[];
    agora?: Date;
  }): Promise<DiasDisponiveisDTO> {
    if (params.servicoIds.length === 0) {
      throw new BadRequestException('Informe ao menos um serviço');
    }
    if (params.de > params.ate) {
      throw new BadRequestException('Período inválido');
    }
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
    const duracaoTotalMs = servicos.reduce((acc, s) => acc + s.duracaoMinutos, 0) * 60_000;

    const { inicio: periodoInicio } = limitesDoDiaCivil(params.de, tz);
    const { fimExclusivo: periodoFim } = limitesDoDiaCivil(params.ate, tz);

    // As DUAS únicas queries, cobrindo o período inteiro de uma vez.
    const [janelas, ocupados] = await Promise.all([
      this.prisma.disponibilidade.findMany({
        where: { barbeiroId: params.barbeiroId, data: { gte: params.de, lte: params.ate } },
        orderBy: { inicio: 'asc' },
      }),
      this.prisma.atendimento.findMany({
        where: {
          barbeiroId: params.barbeiroId,
          inicio: { lt: periodoFim },
          fim: { gt: periodoInicio },
          OR: ocupamOHorario(agora),
        },
        select: { inicio: true, fim: true },
      }),
    ]);

    const janelasPorDia = new Map<string, typeof janelas>();
    for (const janela of janelas) {
      const doDia = janelasPorDia.get(janela.data) ?? [];
      doDia.push(janela);
      janelasPorDia.set(janela.data, doDia);
    }

    const dias: DiasDisponiveisDTO['dias'] = [];
    for (let dia = params.de; dia <= params.ate; dia = somarDias(dia, 1)) {
      const doDia = janelasPorDia.get(dia) ?? [];
      dias.push({
        data: dia,
        disponivel:
          !this.diaBloqueado(dia, params.diasPermitidos) &&
          this.temAlgumSlot(doDia, ocupados, duracaoTotalMs, agora),
      });
    }
    return { dias };
  }

  /**
   * ★ O dia da semana vem do dia CIVIL da empresa, nunca do instante UTC.
   *
   * `data` já É o dia civil no fuso da empresa (todo slot listado nasce dentro
   * de `limitesDoDiaCivil(data, tz)`), então `diaDaSemanaCivil` só lê a data —
   * não há como um horário de sexta 23h ser contado como sábado aqui.
   *
   * Sem restrição (`undefined`) = consulta que não é de crédito de pacote:
   * avulso, saldo residual. Nada é filtrado.
   */
  private diaBloqueado(data: string, diasPermitidos: number[] | undefined): boolean {
    if (!diasPermitidos) return false;
    return !diasPermitidos.includes(diaDaSemanaCivil(data));
  }

  /** Igual ao laço de `disponiveis`, mas para no primeiro slot que serve. */
  private temAlgumSlot(
    janelas: { inicio: Date; fim: Date }[],
    ocupados: { inicio: Date; fim: Date }[],
    duracaoTotalMs: number,
    agora: Date,
  ): boolean {
    const passoMs = PASSO_MINUTOS * 60_000;
    for (const janela of janelas) {
      const ultimoInicio = janela.fim.getTime() - duracaoTotalMs;
      for (let t = janela.inicio.getTime(); t <= ultimoInicio; t += passoMs) {
        if (t <= agora.getTime()) continue;
        const fim = t + duracaoTotalMs;
        const conflita = ocupados.some((o) => t < o.fim.getTime() && o.inicio.getTime() < fim);
        if (!conflita) return true;
      }
    }
    return false;
  }

  /**
   * Barbeiros ATIVOS que atendem TODOS os serviços escolhidos — o conjunto de
   * candidatos quando o cliente não tem preferência. "Todos" e não "algum":
   * um barbeiro que faz corte mas não faz barba não pode atender um carrinho
   * de corte + barba.
   */
  async barbeirosQueAtendem(companyId: string, servicoIds: string[]): Promise<string[]> {
    const unicos = [...new Set(servicoIds)];
    const barbeiros = await this.prisma.barbeiro.findMany({
      where: {
        companyId,
        ativo: true,
        // Um vínculo por serviço exigido; o count abaixo confirma que são todos.
        servicosAtendidos: { some: { servicoId: { in: unicos } } },
      },
      select: { id: true, servicosAtendidos: { select: { servicoId: true } } },
    });
    return barbeiros
      .filter((b) => {
        const atende = new Set(b.servicosAtendidos.map((s) => s.servicoId));
        return unicos.every((id) => atende.has(id));
      })
      .map((b) => b.id);
  }

  /**
   * Horários livres na UNIÃO de todos os barbeiros que atendem os serviços —
   * é o que o funil mostra quando o cliente escolhe "não tenho preferência".
   *
   * Um horário aparece se PELO MENOS UM barbeiro apto está livre nele. Quem
   * vai atender só é decidido na confirmação (ver `regra-atribuicao-de-barbeiro`),
   * porque entre a listagem e a confirmação a agenda pode mudar.
   *
   * Custo: duas queries para o conjunto inteiro de barbeiros, não uma por
   * barbeiro — mesma disciplina de `diasComHorario`.
   */
  async disponiveisGlobal(params: {
    companyId: string;
    data: string;
    servicoIds: string[];
    /** Snapshot da venda quando a consulta é para gastar crédito (2026-08-28). */
    diasPermitidos?: number[];
    agora?: Date;
  }): Promise<HorariosDisponiveisDTO> {
    if (this.diaBloqueado(params.data, params.diasPermitidos)) {
      return { data: params.data, horarios: [] };
    }
    const { duracaoTotalMs, tz } = await this.prepararCarrinho(params.companyId, params.servicoIds);
    const agora = params.agora ?? new Date();
    const barbeiroIds = await this.barbeirosQueAtendem(params.companyId, params.servicoIds);
    if (barbeiroIds.length === 0) return { data: params.data, horarios: [] };

    const { inicio: diaInicio, fimExclusivo: diaFim } = limitesDoDiaCivil(params.data, tz);
    const [janelas, ocupados] = await Promise.all([
      this.prisma.disponibilidade.findMany({
        where: { barbeiroId: { in: barbeiroIds }, data: params.data },
        orderBy: { inicio: 'asc' },
      }),
      this.prisma.atendimento.findMany({
        where: {
          barbeiroId: { in: barbeiroIds },
          inicio: { lt: diaFim },
          fim: { gt: diaInicio },
          OR: ocupamOHorario(agora),
        },
        select: { barbeiroId: true, inicio: true, fim: true },
      }),
    ]);

    // Um slot entra na união se couber na agenda de QUALQUER barbeiro apto.
    const porBarbeiro = new Map<string, { inicio: Date; fim: Date }[]>();
    for (const o of ocupados) {
      const lista = porBarbeiro.get(o.barbeiroId) ?? [];
      lista.push(o);
      porBarbeiro.set(o.barbeiroId, lista);
    }

    const inicios = new Set<number>();
    for (const janela of janelas) {
      const ocupadosDele = porBarbeiro.get(janela.barbeiroId) ?? [];
      for (const t of this.slotsLivres(janela, ocupadosDele, duracaoTotalMs, agora)) {
        inicios.add(t);
      }
    }

    const horarios = [...inicios]
      .sort((a, b) => a - b)
      .map((t) => ({
        horaInicio: horaLocalHHmm(new Date(t), tz),
        inicioIso: new Date(t).toISOString(),
      }));
    return { data: params.data, horarios };
  }

  /** Versão global de `diasComHorario` — mesma união, para riscar datas no seletor. */
  async diasComHorarioGlobal(params: {
    companyId: string;
    de: string;
    ate: string;
    servicoIds: string[];
    /** Snapshot da venda quando a consulta é para gastar crédito (2026-08-28). */
    diasPermitidos?: number[];
    agora?: Date;
  }): Promise<DiasDisponiveisDTO> {
    if (params.de > params.ate) throw new BadRequestException('Período inválido');
    const { duracaoTotalMs, tz } = await this.prepararCarrinho(params.companyId, params.servicoIds);
    const agora = params.agora ?? new Date();
    const barbeiroIds = await this.barbeirosQueAtendem(params.companyId, params.servicoIds);

    const dias: DiasDisponiveisDTO['dias'] = [];
    if (barbeiroIds.length === 0) {
      for (let dia = params.de; dia <= params.ate; dia = somarDias(dia, 1)) {
        dias.push({ data: dia, disponivel: false });
      }
      return { dias };
    }

    const { inicio: periodoInicio } = limitesDoDiaCivil(params.de, tz);
    const { fimExclusivo: periodoFim } = limitesDoDiaCivil(params.ate, tz);
    const [janelas, ocupados] = await Promise.all([
      this.prisma.disponibilidade.findMany({
        where: { barbeiroId: { in: barbeiroIds }, data: { gte: params.de, lte: params.ate } },
        orderBy: { inicio: 'asc' },
      }),
      this.prisma.atendimento.findMany({
        where: {
          barbeiroId: { in: barbeiroIds },
          inicio: { lt: periodoFim },
          fim: { gt: periodoInicio },
          OR: ocupamOHorario(agora),
        },
        select: { barbeiroId: true, inicio: true, fim: true },
      }),
    ]);

    const ocupadosPorBarbeiro = new Map<string, { inicio: Date; fim: Date }[]>();
    for (const o of ocupados) {
      const lista = ocupadosPorBarbeiro.get(o.barbeiroId) ?? [];
      lista.push(o);
      ocupadosPorBarbeiro.set(o.barbeiroId, lista);
    }
    const janelasPorDia = new Map<string, typeof janelas>();
    for (const j of janelas) {
      const doDia = janelasPorDia.get(j.data) ?? [];
      doDia.push(j);
      janelasPorDia.set(j.data, doDia);
    }

    for (let dia = params.de; dia <= params.ate; dia = somarDias(dia, 1)) {
      const doDia = this.diaBloqueado(dia, params.diasPermitidos)
        ? []
        : janelasPorDia.get(dia) ?? [];
      const disponivel = doDia.some(
        (janela) =>
          this.slotsLivres(
            janela,
            ocupadosPorBarbeiro.get(janela.barbeiroId) ?? [],
            duracaoTotalMs,
            agora,
            true,
          ).length > 0,
      );
      dias.push({ data: dia, disponivel });
    }
    return { dias };
  }

  /**
   * Barbeiros aptos que estão REALMENTE livres num intervalo — usado na
   * confirmação sem preferência, imediatamente antes de atribuir. A listagem
   * de horários é projeção; esta checagem é a que vale, porque entre ver o
   * horário e confirmar a agenda pode ter mudado.
   */
  async barbeirosLivresEm(params: {
    companyId: string;
    servicoIds: string[];
    inicio: Date;
    fim: Date;
    agora?: Date;
  }): Promise<string[]> {
    const agora = params.agora ?? new Date();
    const tz = await this.parametros.timezone(params.companyId);
    const aptos = await this.barbeirosQueAtendem(params.companyId, params.servicoIds);
    if (aptos.length === 0) return [];

    const data = diaCivilChave(params.inicio, tz);
    const [janelas, ocupados] = await Promise.all([
      this.prisma.disponibilidade.findMany({ where: { barbeiroId: { in: aptos }, data } }),
      this.prisma.atendimento.findMany({
        where: {
          barbeiroId: { in: aptos },
          inicio: { lt: params.fim },
          fim: { gt: params.inicio },
          OR: ocupamOHorario(agora),
        },
        select: { barbeiroId: true },
      }),
    ]);

    const ocupadosIds = new Set(ocupados.map((o) => o.barbeiroId));
    // Livre = tem janela que CABE o intervalo inteiro e nenhum conflito nele.
    return aptos.filter(
      (id) =>
        !ocupadosIds.has(id) &&
        janelas.some(
          (j) =>
            j.barbeiroId === id &&
            j.inicio.getTime() <= params.inicio.getTime() &&
            j.fim.getTime() >= params.fim.getTime(),
        ),
    );
  }

  /** Validação + duração total, compartilhada pelas consultas globais. */
  private async prepararCarrinho(companyId: string, servicoIds: string[]) {
    if (servicoIds.length === 0) throw new BadRequestException('Informe ao menos um serviço');
    const tz = await this.parametros.timezone(companyId);
    const servicos = await this.prisma.servico.findMany({
      where: { id: { in: servicoIds }, companyId },
    });
    if (servicos.length !== new Set(servicoIds).size) {
      throw new NotFoundException('Serviço inexistente');
    }
    const inativo = servicos.find((s) => !s.ativo);
    if (inativo) throw new BadRequestException(`Serviço ${inativo.nome} está inativo`);
    return { tz, duracaoTotalMs: servicos.reduce((a, s) => a + s.duracaoMinutos, 0) * 60_000 };
  }

  /** Instantes de início livres dentro de UMA janela. `pararNoPrimeiro` corta cedo. */
  private slotsLivres(
    janela: { inicio: Date; fim: Date },
    ocupados: { inicio: Date; fim: Date }[],
    duracaoTotalMs: number,
    agora: Date,
    pararNoPrimeiro = false,
  ): number[] {
    const passoMs = PASSO_MINUTOS * 60_000;
    const encontrados: number[] = [];
    const ultimoInicio = janela.fim.getTime() - duracaoTotalMs;
    for (let t = janela.inicio.getTime(); t <= ultimoInicio; t += passoMs) {
      if (t <= agora.getTime()) continue;
      const fim = t + duracaoTotalMs;
      if (ocupados.some((o) => t < o.fim.getTime() && o.inicio.getTime() < fim)) continue;
      encontrados.push(t);
      if (pararNoPrimeiro) break;
    }
    return encontrados;
  }

}
