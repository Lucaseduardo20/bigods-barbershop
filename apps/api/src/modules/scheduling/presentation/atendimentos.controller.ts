import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  Min,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AgendarResponse,
  AtendimentoDTO,
  FormaPagamento,
  Papel,
} from '@bigods/contracts';
import { AgendarAvulsoUseCase } from '../application/agendar-avulso.usecase';
import { AgendarComCreditoUseCase } from '../application/agendar-com-credito.usecase';
import { ConcluirAtendimentoUseCase } from '../application/concluir-atendimento.usecase';
import { creditosDaRequisicao } from '../application/agendar-com-credito.usecase';
import {
  AprovarConclusaoAntecipadaUseCase,
  RecusarConclusaoAntecipadaUseCase,
} from '../application/resolver-conclusao-antecipada.usecase';
import { CancelarAtendimentoUseCase } from '../application/cancelar-atendimento.usecase';
import { RegistrarNaoComparecimentoUseCase } from '../application/registrar-nao-comparecimento.usecase';
import { AdicionarItemAtendimentoUseCase } from '../application/adicionar-item-atendimento.usecase';
import { AdicionarProdutoAtendimentoUseCase } from '../application/adicionar-produto-atendimento.usecase';
import { AgendaQueryService } from '../infrastructure/agenda-query.service';
import { EditarComandaUseCase } from '../application/editar-comanda.usecase';
import { ProcessarWebhookUseCase } from '../../payments/application/processar-webhook.usecase';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../../payments/domain/intencao-de-pagamento.repository';
import {
  VENDA_DE_PACOTE_REPOSITORY,
  VendaDePacoteRepository,
} from '../../packages/domain/venda-de-pacote.repository';
import { diferencaDiasCivis, instanteDeDataHoraLocal } from '../../../shared/domain/calendario';
import {
  PARAMETROS_DA_EMPRESA_REPOSITORY,
  ParametrosDaEmpresaRepository,
} from '../../packages/domain/parametros-da-empresa.repository';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "No máximo 1 mês" — interpretado como 31 dias corridos (inclusive nas duas pontas). */
// DECISAO_PENDENTE: "1 mês" poderia significar mês-calendário (28-31 dias variável); usei 31 dias fixos por simplicidade.
const PERIODO_MAXIMO_DIAS = 31;

class ClienteInlineDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class AgendarAvulsoDto {
  @IsString() barbeiroId!: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) servicoIds!: string[];
  @Matches(DATA_ISO) data!: string;
  /** Horário de parede LOCAL (fuso da empresa) — nunca ISO/UTC pré-construído. */
  @Matches(HORA_HHMM) horaInicio!: string;
  @ValidateNested() @Type(() => ClienteInlineDto) cliente!: ClienteInlineDto;
  @IsOptional() @IsBoolean() gerarCobranca?: boolean;
}

class AgendarComCreditoDto {
  @IsString() vendaId!: string;
  /** Vários créditos do mesmo pacote = uma visita só (2026-08-21). */
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds?: string[];
  /** DEPRECADO — compatibilidade com o app publicado durante o deploy. */
  @IsOptional() @IsString() itemId?: string;
  @IsString() barbeiroId!: string;
  @Matches(DATA_ISO) data!: string;
  @Matches(HORA_HHMM) horaInicio!: string;
}

class ConcluirDto {
  @IsOptional() @IsEnum(FormaPagamento) formaPagamento?: FormaPagamento;
  /** Obrigatório apenas quando o horário do atendimento ainda não começou. */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) motivoConclusaoAntecipada?: string;
  /**
   * FASE 3 (2026-08-25) — em CENTAVOS, inteiros. Declarados pelo barbeiro na
   * etapa de pagamento; o sistema nunca os deduz de "pagou mais/menos".
   * O teto do desconto (não passar do total da comanda) é invariante de
   * domínio, não validação de borda — depende da comanda, que o DTO não conhece.
   */
  @IsOptional() @IsInt() @Min(0) caixinhaCentavos?: number;
  @IsOptional() @IsInt() @Min(0) descontoCentavos?: number;
}

class CancelarDto {
  @IsString() @MinLength(1) motivo!: string;
}

class AdicionarItemDto {
  @IsString() @MinLength(1) servicoId!: string;
}

class AdicionarProdutoDto {
  @IsString() @MinLength(1) produtoId!: string;
  @IsOptional() @IsInt() @IsPositive() quantidade?: number;
}

@Controller('atendimentos')
export class AtendimentosController {
  constructor(
    private readonly agendarAvulso: AgendarAvulsoUseCase,
    private readonly agendarComCredito: AgendarComCreditoUseCase,
    private readonly concluir: ConcluirAtendimentoUseCase,
    private readonly aprovarConclusao: AprovarConclusaoAntecipadaUseCase,
    private readonly recusarConclusao: RecusarConclusaoAntecipadaUseCase,
    private readonly cancelar: CancelarAtendimentoUseCase,
    private readonly registrarFalta: RegistrarNaoComparecimentoUseCase,
    private readonly adicionarItem: AdicionarItemAtendimentoUseCase,
    private readonly adicionarProduto: AdicionarProdutoAtendimentoUseCase,
    private readonly agenda: AgendaQueryService,
    private readonly editarComanda: EditarComandaUseCase,
    @Inject(PARAMETROS_DA_EMPRESA_REPOSITORY) private readonly parametros: ParametrosDaEmpresaRepository,
    @Inject(VENDA_DE_PACOTE_REPOSITORY) private readonly vendasDePacote: VendaDePacoteRepository,
    private readonly processarWebhook: ProcessarWebhookUseCase,
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY) private readonly intencoes: IntencaoDePagamentoRepository,
  ) {}

  @Get()
  async listar(
    @Query('de') de: string,
    @Query('ate') ate: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('barbeiroId') barbeiroId?: string,
  ): Promise<AtendimentoDTO[]> {
    if (!de || !DATA_ISO.test(de) || !ate || !DATA_ISO.test(ate)) {
      throw new BadRequestException('Parâmetros de/ate obrigatórios (YYYY-MM-DD, dia civil local)');
    }
    if (de > ate) {
      throw new BadRequestException('Parâmetro de deve ser anterior ou igual a ate');
    }
    if (diferencaDiasCivis(de, ate) > PERIODO_MAXIMO_DIAS) {
      throw new BadRequestException(`Período máximo de consulta é de ${PERIODO_MAXIMO_DIAS} dias`);
    }
    // Barbeiro sem papel de admin só enxerga a própria agenda
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    const filtroBarbeiro = ehAdmin ? barbeiroId : usuario.barbeiroId;
    const tz = await this.parametros.timezone(usuario.companyId);
    return this.agenda.listar({
      companyId: usuario.companyId,
      deLocal: de,
      ateLocal: ate,
      tz,
      barbeiroId: filtroBarbeiro,
    });
  }

  @Get(':id')
  async detalhe(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AtendimentoDTO> {
    const atendimento = await this.agenda.porId(id, usuario.companyId);
    if (!atendimento) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    if (!ehAdmin && atendimento.barbeiro.id !== usuario.barbeiroId) {
      throw new ForbiddenException('Barbeiro só visualiza os próprios atendimentos');
    }
    return atendimento;
  }

  @Post()
  async criarAvulso(
    @Body() body: AgendarAvulsoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AgendarResponse> {
    const tz = await this.parametros.timezone(usuario.companyId);
    const resultado = await this.agendarAvulso.executar({
      companyId: usuario.companyId,
      barbeiroId: body.barbeiroId,
      servicoIds: body.servicoIds,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
      cliente: body.cliente,
      gerarCobranca: body.gerarCobranca,
      // Sessão de OTP+reserva (Problema 3): cota de presenciais é anti-abuso
      // do canal de auto-atendimento — o admin agenda por julgamento próprio,
      // sem essa trava.
      aplicarCotaPresencial: false,
      // Mesma razão: a janela de 30 dias é trava do auto-atendimento. O admin
      // precisa poder encaixar um cliente daqui a três meses se a operação pedir.
      aplicarJanelaDeAgendamento: false,
    });
    // `pagamentoManual` vem no lugar de `cobranca` quando o modo manual está
    // ligado — este caminho quase não é usado (o admin cobra na conclusão),
    // mas devolver os dois nulos seria um beco sem saída silencioso.
    return {
      atendimentoId: resultado.atendimentoId,
      cobranca: resultado.cobranca,
      pagamentoManual: resultado.pagamentoManual,
    };
  }

  /**
   * Agendar consumindo crédito. ACL (2026-08-18): barbeiro não-admin só mexe
   * em pacote comprado COM ELE, e o atendimento sai no nome dele — mesmo
   * escopo da agenda e da listagem de pacotes. Pacote comprado sem barbeiro
   * escolhido não é de ninguém em particular: quem decide quem atende é o
   * admin. A checagem é aqui, na borda, como no cockpit do cliente.
   */
  @Post('com-credito')
  async criarComCredito(
    @Body() body: AgendarComCreditoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<AgendarResponse> {
    const ehAdmin = usuario.papeis.includes(Papel.ADMIN);
    if (!ehAdmin) {
      const venda = await this.vendasDePacote.porId(body.vendaId);
      if (!venda || venda.companyId !== usuario.companyId) {
        throw new NotFoundException('Pacote não encontrado');
      }
      if (venda.barbeiroId !== usuario.barbeiroId) {
        throw new ForbiddenException('Este pacote não foi comprado com você');
      }
      if (body.barbeiroId !== usuario.barbeiroId) {
        throw new ForbiddenException('Você só pode agendar em seu próprio nome');
      }
    }
    const tz = await this.parametros.timezone(usuario.companyId);
    const resultado = await this.agendarComCredito.executar({
      companyId: usuario.companyId,
      vendaId: body.vendaId,
      itemIds: creditosDaRequisicao(body),
      barbeiroId: body.barbeiroId,
      inicio: instanteDeDataHoraLocal(body.data, body.horaInicio, tz),
    });
    return { atendimentoId: resultado.atendimentoId, cobranca: null };
  }

  /** Item 3 da sessão 2026-07-16 (walk-in add-on): adiciona serviço ANTES de concluir. */
  @Post(':id/itens')
  async adicionarItemAtendimento(
    @Param('id') id: string,
    @Body() body: AdicionarItemDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.adicionarItem.executar({ atendimentoId: id, servicoId: body.servicoId, usuario });
    return { ok: true };
  }

  /**
   * COMANDA EDITÁVEL (2026-08-25, FASE 1): remove um serviço da comanda.
   *
   * O índice vem na rota e o `servicoId` na query como CONFIRMAÇÃO do que o
   * painel achava que estava ali — `ItemAtendido` não tem identidade estável
   * (o repositório recria a lista a cada save), então a alça é a posição, e a
   * posição sozinha remove o item errado se a lista mudou. Ver
   * `Atendimento.removerItem`.
   */
  @Delete(':id/itens/:indice')
  async removerItemAtendimento(
    @Param('id') id: string,
    @Param('indice', ParseIntPipe) indice: number,
    @Query('servicoId') servicoId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    if (!servicoId) {
      throw new BadRequestException('Informe o servicoId do item que está sendo removido');
    }
    await this.editarComanda.removerItem({ atendimentoId: id, indice, servicoId, usuario });
    return { ok: true };
  }

  /** Gêmeo do anterior, para produtos. */
  @Delete(':id/produtos/:indice')
  async removerProdutoAtendimento(
    @Param('id') id: string,
    @Param('indice', ParseIntPipe) indice: number,
    @Query('produtoId') produtoId: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    if (!produtoId) {
      throw new BadRequestException('Informe o produtoId do item que está sendo removido');
    }
    await this.editarComanda.removerProduto({ atendimentoId: id, indice, produtoId, usuario });
    return { ok: true };
  }

  /** Item 4a da sessão 2026-07-16: produto vendido junto do atendimento, ANTES de concluir. */
  @Post(':id/produtos')
  async adicionarProdutoAtendimento(
    @Param('id') id: string,
    @Body() body: AdicionarProdutoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.adicionarProduto.executar({
      atendimentoId: id,
      produtoId: body.produtoId,
      quantidade: body.quantidade ?? 1,
      usuario,
    });
    return { ok: true };
  }

  /**
   * Confirma manualmente o pagamento online de um atendimento — o gêmeo do
   * `POST /pacotes/:id/confirmar-pagamento`, para o modo de pagamento manual
   * por WhatsApp (TEMPORÁRIO, 2026-08-18) e para qualquer PIX que caia por
   * fora do gateway.
   *
   * REUSA `ProcessarWebhookUseCase`: mesmo caminho idempotente do gateway
   * (confirma a intenção e transiciona a reserva RESERVADO→AGENDADO na mesma
   * transação), só que disparado pelo admin em vez do webhook. É o mesmo
   * padrão que o `confirmar-demo` do funil já usava — nenhuma regra nova de
   * pagamento foi escrita.
   */
  @Papeis(Papel.ADMIN)
  @Post(':id/confirmar-pagamento')
  async confirmarPagamentoOnline(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ processado: boolean }> {
    const atendimento = await this.agenda.porId(id, usuario.companyId);
    if (!atendimento) {
      throw new NotFoundException('Atendimento não encontrado');
    }
    const intencao = await this.intencoes.porReferenciaAtendimento(id);
    if (!intencao) {
      throw new NotFoundException(
        'Este atendimento não tem cobrança online pendente (foi marcado para pagar na barbearia).',
      );
    }
    return this.processarWebhook.executar({ externalId: intencao.externalId });
  }

  @Post(':id/concluir')
  async concluirAtendimento(
    @Param('id') id: string,
    @Body() body: ConcluirDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true; concluido: boolean }> {
    // `concluido: false` = ficou pendente de aprovação do admin (conclusão
    // antecipada). O front usa isso pra dizer o que aconteceu de verdade em
    // vez de anunciar "atendimento concluído" sobre algo que não concluiu.
    const { concluido } = await this.concluir.executar({
      atendimentoId: id,
      formaPagamento: body.formaPagamento,
      motivoConclusaoAntecipada: body.motivoConclusaoAntecipada,
      caixinhaCentavos: body.caixinhaCentavos,
      descontoCentavos: body.descontoCentavos,
      usuario,
    });
    return { ok: true, concluido };
  }

  @Post(':id/aprovar-conclusao')
  @Papeis(Papel.ADMIN)
  async aprovarConclusaoAntecipada(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.aprovarConclusao.executar({ atendimentoId: id, usuario });
    return { ok: true };
  }

  @Post(':id/recusar-conclusao')
  @Papeis(Papel.ADMIN)
  async recusarConclusaoAntecipada(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.recusarConclusao.executar({ atendimentoId: id, usuario });
    return { ok: true };
  }

  @Post(':id/cancelar')
  async cancelarAtendimento(
    @Param('id') id: string,
    @Body() body: CancelarDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.cancelar.executar({ atendimentoId: id, motivo: body.motivo, usuario });
    return { ok: true };
  }

  @Post(':id/nao-compareceu')
  async naoCompareceu(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<{ ok: true }> {
    await this.registrarFalta.executar({ atendimentoId: id, usuario });
    return { ok: true };
  }
}
