import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import {
  ConfiguracaoDeOrderBumpDTO,
  ConfigurarItemDeOrderBumpRequest,
  MAX_MENSAGEM_BUMP,
  Papel,
  TipoItemDeOrderBump as TipoDTO,
} from '@bigods/contracts';
import {
  ITEM_DE_ORDER_BUMP_REPOSITORY,
  ItemDeOrderBumpRepository,
} from '../domain/item-de-order-bump.repository';
import { ItemDeOrderBump, TipoItemDeOrderBump } from '../domain/item-de-order-bump.aggregate';
import { SERVICO_REPOSITORY, ServicoRepository } from '../../catalog/domain/servico.repository';
import { PRODUTO_REPOSITORY, ProdutoRepository } from '../../products/domain/produto.repository';
import { Dinheiro } from '../../../shared/domain/dinheiro';
import { Papeis, UsuarioAtual } from '../../identity/presentation/auth.decorators';
import { UsuarioAutenticado } from '../../identity/domain/auth-provider';

class ConfigurarDto implements ConfigurarItemDeOrderBumpRequest {
  @IsBoolean() ativo!: boolean;
  // `null` explícito remove a promoção — por isso não é só @IsOptional.
  @IsOptional() @IsInt() @IsPositive() precoPromocionalCentavos?: number | null;
  @IsOptional() @IsString() @MaxLength(MAX_MENSAGEM_BUMP) mensagem?: string | null;
  @IsOptional() @IsInt() @Min(0) ordem?: number;
}

/**
 * Configuração do order-bump — a tela "Funil de Vendas" do admin (Parte 1 da
 * sessão 2026-08-17 criou a seção; a Parte 2 encheu ela de conteúdo).
 *
 * A listagem devolve o CATÁLOGO INTEIRO (ativo) com a configuração de bump
 * anexada, em vez de só os itens já configurados: o admin precisa ver o que
 * PODE oferecer, não só o que já oferece. Item nunca configurado aparece com
 * `ativoNoBump: false` e sem promoção.
 */
@Papeis(Papel.ADMIN)
@Controller('order-bump')
export class OrderBumpConfigController {
  constructor(
    @Inject(ITEM_DE_ORDER_BUMP_REPOSITORY) private readonly itens: ItemDeOrderBumpRepository,
    @Inject(SERVICO_REPOSITORY) private readonly servicos: ServicoRepository,
    @Inject(PRODUTO_REPOSITORY) private readonly produtos: ProdutoRepository,
  ) {}

  @Get('configuracao')
  async listar(@UsuarioAtual() usuario: UsuarioAutenticado): Promise<ConfiguracaoDeOrderBumpDTO[]> {
    const [servicos, produtos, configurados] = await Promise.all([
      this.servicos.listar(usuario.companyId),
      this.produtos.listar(usuario.companyId),
      this.itens.listarPorEmpresa(usuario.companyId),
    ]);
    const porChave = new Map(configurados.map((i) => [`${i.tipo}:${i.referenciaId}`, i]));

    const linhas: ConfiguracaoDeOrderBumpDTO[] = [
      ...servicos
        .filter((s) => s.ativo)
        .map((s) =>
          this.paraDTO(
            TipoItemDeOrderBump.SERVICO,
            s.id,
            s.nome,
            s.precoAvulso.centavos,
            porChave.get(`${TipoItemDeOrderBump.SERVICO}:${s.id}`),
          ),
        ),
      ...produtos
        .filter((p) => p.ativo)
        .map((p) =>
          this.paraDTO(
            TipoItemDeOrderBump.PRODUTO,
            p.id,
            p.nome,
            p.preco.centavos,
            porChave.get(`${TipoItemDeOrderBump.PRODUTO}:${p.id}`),
          ),
        ),
    ];
    // Configurados primeiro (por ordem), depois o resto do catálogo por nome —
    // o admin abre a tela e vê o que já está no ar no topo.
    return linhas.sort((a, b) => {
      if (a.ativoNoBump !== b.ativoNoBump) return a.ativoNoBump ? -1 : 1;
      if (a.ordem !== b.ordem) return a.ordem - b.ordem;
      return a.nome.localeCompare(b.nome);
    });
  }

  /**
   * Upsert por (tipo, referência) — o admin não gerencia "linhas de
   * configuração", ele configura um item do catálogo que já existe.
   */
  @Put(':tipo/:referenciaId')
  async configurar(
    @Param('tipo') tipoParam: string,
    @Param('referenciaId') referenciaId: string,
    @Body() body: ConfigurarDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ): Promise<ConfiguracaoDeOrderBumpDTO> {
    const tipo = this.exigirTipo(tipoParam);
    const { nome, precoBase } = await this.resolverItemDoCatalogo(usuario.companyId, tipo, referenciaId);

    const dados = {
      precoPromocional:
        body.precoPromocionalCentavos === null || body.precoPromocionalCentavos === undefined
          ? null
          : Dinheiro.deCentavos(body.precoPromocionalCentavos),
      mensagem: body.mensagem ?? null,
      ordem: body.ordem ?? 0,
    };

    const existente = await this.itens.porReferencia(usuario.companyId, tipo, referenciaId);
    const item =
      existente ??
      ItemDeOrderBump.criar(
        { id: randomUUID(), companyId: usuario.companyId, tipo, referenciaId },
        precoBase,
      );
    item.configurar(dados, precoBase);
    if (body.ativo) item.ativar();
    else item.desativar();
    await this.itens.salvar(item);

    return this.paraDTO(tipo, referenciaId, nome, precoBase.centavos, item);
  }

  private paraDTO(
    tipo: TipoItemDeOrderBump,
    id: string,
    nome: string,
    precoNormalCentavos: number,
    config: ItemDeOrderBump | undefined,
  ): ConfiguracaoDeOrderBumpDTO {
    return {
      tipo: TipoDTO[tipo],
      id,
      nome,
      precoNormalCentavos,
      ativoNoBump: config?.ativo ?? false,
      precoPromocionalCentavos: config?.precoPromocional?.centavos ?? null,
      mensagem: config?.mensagem ?? null,
      ordem: config?.ordem ?? 0,
    };
  }

  private exigirTipo(tipo: string): TipoItemDeOrderBump {
    if (tipo !== TipoItemDeOrderBump.SERVICO && tipo !== TipoItemDeOrderBump.PRODUTO) {
      throw new BadRequestException('Tipo deve ser SERVICO ou PRODUTO');
    }
    return tipo;
  }

  /** O item precisa existir, ser desta empresa e estar ativo — não se oferece o que não está à venda. */
  private async resolverItemDoCatalogo(
    companyId: string,
    tipo: TipoItemDeOrderBump,
    referenciaId: string,
  ): Promise<{ nome: string; precoBase: Dinheiro }> {
    if (tipo === TipoItemDeOrderBump.SERVICO) {
      const servico = await this.servicos.porId(referenciaId);
      if (!servico || servico.companyId !== companyId) {
        throw new NotFoundException('Serviço não encontrado');
      }
      if (!servico.ativo) throw new BadRequestException(`Serviço ${servico.nome} está inativo`);
      return { nome: servico.nome, precoBase: servico.precoAvulso };
    }
    const produto = await this.produtos.porId(referenciaId);
    if (!produto || produto.companyId !== companyId) {
      throw new NotFoundException('Produto não encontrado');
    }
    if (!produto.ativo) throw new BadRequestException(`Produto ${produto.nome} está inativo`);
    return { nome: produto.nome, precoBase: produto.preco };
  }
}
