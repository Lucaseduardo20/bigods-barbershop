import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsString, MinLength, ValidateNested } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import {
  FormaPagamentoFunil,
  PacoteOfertaDTO,
  PagamentoStatusDTO,
  VenderPacotePublicoResponse,
} from '@bigods/contracts';
import { PacoteOfertasQueryService } from '../infrastructure/pacote-ofertas-query.service';
import { VenderPacoteUseCase } from '../application/vender-pacote.usecase';
import { PagamentoStatusQueryService } from '../../payments/infrastructure/pagamento-status-query.service';
import { ProcessarWebhookUseCase } from '../../payments/application/processar-webhook.usecase';
import {
  INTENCAO_DE_PAGAMENTO_REPOSITORY,
  IntencaoDePagamentoRepository,
} from '../../payments/domain/intencao-de-pagamento.repository';
import { Publico } from '../../identity/presentation/auth.decorators';

class ClientePublicoDto {
  @IsString() @MinLength(1) nome!: string;
  @IsString() @MinLength(8) telefone!: string;
}

class VenderPacotePublicoDto {
  @IsString() @MinLength(1) companyId!: string;
  @IsString() @MinLength(1) ofertaId!: string;
  @ValidateNested() @Type(() => ClientePublicoDto) cliente!: ClientePublicoDto;
  @IsIn(['online', 'presencial']) formaPagamento!: FormaPagamentoFunil;
}

/**
 * Superfície pública da trilha de pacote do funil (não autenticada, §2.4 tenant
 * explícito). REUSA `VenderPacoteUseCase` — zero regra duplicada. A oferta é um
 * read model (catálogo); a venda expande a oferta nos serviços reais e o rateio
 * do domínio (§3.6) acontece por cima deles.
 *
 * `GET/POST /public/pacotes` e `GET /public/pagamentos/:id` (polling do status
 * da cobrança online, usado também pelo agendamento avulso online).
 */
@Controller('public')
export class PacotesPublicoController {
  constructor(
    private readonly ofertas: PacoteOfertasQueryService,
    private readonly venderPacote: VenderPacoteUseCase,
    private readonly pagamentoStatus: PagamentoStatusQueryService,
    private readonly processarWebhook: ProcessarWebhookUseCase,
    @Inject(INTENCAO_DE_PAGAMENTO_REPOSITORY) private readonly intencoes: IntencaoDePagamentoRepository,
  ) {}

  @Publico()
  @Get('pacotes')
  async listarOfertas(
    @Query('companyId') companyId?: string,
    @Query('servicoId') servicoId?: string,
  ): Promise<PacoteOfertaDTO[]> {
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');
    return this.ofertas.listar(companyId, servicoId);
  }

  @Publico()
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post('pacotes')
  async vender(@Body() body: VenderPacotePublicoDto): Promise<VenderPacotePublicoResponse> {
    const oferta = await this.ofertas.porId(body.companyId, body.ofertaId);
    if (!oferta) throw new NotFoundException('Oferta de pacote não encontrada');

    const resultado = await this.venderPacote.executar({
      companyId: body.companyId,
      cliente: body.cliente,
      // expande a oferta nos serviços reais (o rateio congela por cima destes)
      servicoIds: Array(oferta.quantidade).fill(oferta.servicoId),
      valorPagoCentavos: oferta.precoCentavos,
      pagamentoImediato: false,
      gerarCobranca: body.formaPagamento === 'online',
    });

    return {
      vendaId: resultado.vendaId,
      clienteId: resultado.clienteId,
      intencaoId: resultado.intencaoId,
      cobranca: resultado.cobranca,
    };
  }

  @Publico()
  @Get('pagamentos/:intencaoId')
  async statusPagamento(
    @Param('intencaoId') intencaoId: string,
    @Query('companyId') companyId?: string,
  ): Promise<PagamentoStatusDTO> {
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');
    const status = await this.pagamentoStatus.status(companyId, intencaoId);
    if (!status) throw new NotFoundException('Pagamento não encontrado');
    return status;
  }

  /**
   * Confirmação de pagamento em modo DEMO — o análogo do "código OTP na tela".
   * Como o FakeAbacatePayGateway não expõe webhook, no demo não há como o PIX
   * confirmar sozinho; este endpoint simula essa confirmação, reusando o MESMO
   * caso de uso do webhook real (idempotente por externalId, §3.8). É INERTE
   * fora do modo demo: com DEMO_MODE!=true responde 403 (e o boot já recusa
   * DEMO_MODE=true em produção — nunca fica exposto de verdade).
   */
  @Publico()
  @Post('pagamentos/:intencaoId/confirmar-demo')
  async confirmarDemo(
    @Param('intencaoId') intencaoId: string,
    @Query('companyId') companyId?: string,
  ): Promise<PagamentoStatusDTO> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException('Confirmação demo indisponível fora do modo demo');
    }
    if (!companyId) throw new BadRequestException('Parâmetro companyId obrigatório');

    const intencao = await this.intencoes.porId(intencaoId);
    if (!intencao || intencao.companyId !== companyId) {
      throw new NotFoundException('Pagamento não encontrado');
    }
    await this.processarWebhook.executar({ externalId: intencao.externalId });

    const status = await this.pagamentoStatus.status(companyId, intencaoId);
    if (!status) throw new NotFoundException('Pagamento não encontrado');
    return status;
  }
}

