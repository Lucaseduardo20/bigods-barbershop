import { Controller, Get, Query } from '@nestjs/common';
import { Papel } from '@bigods/contracts';
import { OtpAuditoriaDTO } from '@bigods/contracts';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { Telefone } from '../../../shared/domain/telefone';
import { Papeis, UsuarioAtual } from './auth.decorators';
import { UsuarioAutenticado } from '../domain/auth-provider';

/** Quantos códigos recentes a consulta devolve. Cabe numa tela sem paginar. */
const LIMITE = 30;

/**
 * ★ AUDITORIA DE CÓDIGOS ENVIADOS (2026-08-28) — controle operacional.
 *
 * Existe por um caso concreto e chato: o cliente liga dizendo "pedi o código e
 * não chegou". Sem isto, o dono não tem como saber se o sistema chegou a gerar
 * o código, se o cliente digitou errado cinco vezes, ou se o SMS morreu no
 * caminho da operadora — e a conversa vira a palavra de um contra a do outro.
 *
 * Com isto ele vê: gerado às 14:02, para recuperar senha, NUNCA usado. Aí liga
 * de volta e resolve na mão, que é o fallback aceito para o caso raro.
 *
 * ## O que este endpoint NUNCA devolve
 *
 * O código. Ele só existe como HMAC no banco, desde sempre, e continua assim —
 * não há caminho para recuperá-lo, nem aqui nem em lugar nenhum. Um endpoint
 * que revelasse o código transformaria o painel numa forma de entrar na conta
 * de qualquer cliente.
 *
 * Admin-only pelo mesmo motivo: saber QUANDO alguém pediu acesso à conta já é
 * informação sobre a vida de uma pessoa real.
 */
@Papeis(Papel.ADMIN)
@Controller('otp/auditoria')
export class OtpAuditoriaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('telefone') telefone?: string,
  ): Promise<OtpAuditoriaDTO[]> {
    // Sem telefone, os últimos de todo mundo: é como o dono começa a olhar
    // quando não sabe de quem é a reclamação.
    let filtroDeTelefone: string | undefined;
    if (telefone?.trim()) {
      try {
        filtroDeTelefone = Telefone.de(telefone).e164;
      } catch {
        // Número mal digitado não é erro de sistema — devolve vazio, e a tela
        // diz que não encontrou.
        return [];
      }
    }

    const linhas = await this.prisma.demoDesafioLogin.findMany({
      where: { companyId: usuario.companyId, ...(filtroDeTelefone ? { telefone: filtroDeTelefone } : {}) },
      orderBy: { criadoEm: 'desc' },
      take: LIMITE,
    });

    const agora = Date.now();
    return linhas.map((l) => ({
      id: l.id,
      telefone: l.telefone,
      finalidade: l.finalidade,
      geradoEm: l.criadoEm.toISOString(),
      usadoEm: l.consumidoEm?.toISOString() ?? null,
      tentativas: l.tentativas,
      // Derivado, não guardado: "expirou" é só o relógio passando do prazo.
      expirado: !l.consumidoEm && l.expiraEm.getTime() < agora,
    }));
  }
}
