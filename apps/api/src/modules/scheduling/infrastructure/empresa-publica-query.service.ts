import { Injectable, NotFoundException } from '@nestjs/common';
import { EmpresaPublicaDTO, PagamentoOnlineDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { lerConfigPagamentoManual } from '../../../shared/config/pagamento-manual';
import { lerConfigMercadoPago } from '../../../shared/config/mercadopago';
import { CobrancaOnlineService } from '../../payments/application/cobranca-online.service';

/** Dados públicos da empresa que o funil precisa (marca + fuso). */
@Injectable()
export class EmpresaPublicaQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cobrancaOnline: CobrancaOnlineService,
  ) {}

  async empresa(companyId: string): Promise<EmpresaPublicaDTO> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      // Sem tenant explícito válido → erro, nunca fallback (DOMAIN.md §2.4)
      throw new NotFoundException(`Empresa ${companyId} não encontrada`);
    }
    const degraus = await this.prisma.degrauDeDesconto.findMany({
      where: { companyId },
      orderBy: { posicao: 'asc' },
    });

    return {
      companyId: company.id,
      nome: company.nome,
      timezone: company.timezone,
      demoMode: process.env.DEMO_MODE === 'true',
      descontoProgressivo: {
        degraus: degraus.map((d) => ({ posicao: d.posicao, valorCentavos: d.valorCentavos })),
        tetoCentavos: company.descontoTetoCentavos,
      },
      // TEMPORÁRIO (2026-08-18): o funil usa só pra trocar o subtítulo do botão
      // ("PIX na hora" → "PIX pelo WhatsApp"). Quem decide de fato é o backend,
      // na resposta da compra — o front nunca escolhe o meio de pagar.
      pagamentoManualWhatsapp: lerConfigPagamentoManual().ativo,
      pagamentoOnline: this.pagamentoOnline(),
      whatsapp: this.whatsapp(),
    };
  }

  /**
   * WhatsApp da barbearia, para as telas que precisam oferecer "falar com a
   * barbearia" — hoje o card de reembolso em análise na conta do cliente.
   *
   * `BARBEARIA_WHATSAPP` é a fonte; `PAGAMENTO_MANUAL_WHATSAPP_NUMERO` é o
   * fallback porque esse número já existia e é o MESMO telefone — pedir ao dono
   * que preencha duas variáveis com o mesmo valor seria uma armadilha.
   *
   * Só dígitos: `wa.me` recusa qualquer outra coisa, e um número com máscara
   * produz um link que abre o WhatsApp em branco — pior que não ter link.
   */
  private whatsapp(): string | null {
    const bruto =
      process.env.BARBEARIA_WHATSAPP ?? process.env.PAGAMENTO_MANUAL_WHATSAPP_NUMERO ?? '';
    const digitos = bruto.replace(/\D/g, '');
    // Menos de 12 dígitos não é um número BR em E.164 (55 + DDD + 8/9). Devolver
    // `null` faz a tela esconder o botão, que é o comportamento certo.
    return digitos.length >= 12 ? digitos : null;
  }

  /**
   * O que o checkout online aceita, e a chave para tokenizar cartão no browser.
   *
   * ## A chave pública, e por que não é uma `VITE_`
   *
   * Ela é pública mas é **por ambiente**: staging e produção têm aplicações
   * diferentes. Embutida no build do funil por `VITE_MERCADOPAGO_PUBLIC_KEY`, ela
   * ficaria congelada no bundle — e um funil de staging apontado para a API de
   * produção tokenizaria com a chave errada, falhando só na hora do pagamento,
   * com erro genérico do gateway. Servida aqui, chave e Access Token vêm sempre
   * da MESMA aplicação, porque vêm do mesmo processo.
   *
   * ## O que NÃO pode aparecer aqui
   *
   * `MERCADOPAGO_ACCESS_TOKEN`. Ele também começa com `APP_USR-`, é
   * indistinguível a olho nu da chave pública, e esta resposta é servida sem
   * autenticação para qualquer visitante do funil. Duas defesas, porque uma é
   * pouco: `config-seguranca.ts` recusa o boot se as duas variáveis forem iguais,
   * e há um teste-cadeado sobre este método.
   *
   * A chave só sai quando o cartão é realmente oferecido — sem cartão, nem chave
   * nem SDK fazem sentido para o funil.
   */
  private pagamentoOnline(): PagamentoOnlineDTO {
    const meios = this.cobrancaOnline.meiosDisponiveis;
    const publicKey = meios.includes('CARTAO_CREDITO')
      ? lerConfigMercadoPago().publicKey
      : '';
    return {
      meios,
      // String vazia (gateway sem cartão, ou env não configurada) vira `null`: o
      // funil trata ausência como "não dá pra tokenizar" e cai no PIX, e `''`
      // passaria pela checagem ingênua `if (publicKey !== null)`.
      mercadoPagoPublicKey: publicKey === '' ? null : publicKey,
    };
  }
}
