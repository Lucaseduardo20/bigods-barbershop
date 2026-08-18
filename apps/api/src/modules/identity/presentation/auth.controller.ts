import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { LoginResponse, UsuarioDTO } from '@bigods/contracts';
import { AUTH_PROVIDER, AuthProvider, UsuarioAutenticado } from '../domain/auth-provider';
import { PrismaService } from '../../../shared/infrastructure/prisma.service';
import { hashSenha } from '../infrastructure/local-auth.provider';
import { Publico, UsuarioAtual } from './auth.decorators';

class LoginDto {
  @IsString() login!: string;
  @IsString() @MinLength(4) senha!: string;
}

class TrocarSenhaDto {
  @IsString() senhaAtual!: string;
  @IsString() @MinLength(4) novaSenha!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly auth: AuthProvider,
    private readonly prisma: PrismaService,
  ) {}

  @Publico()
  @Post('login')
  async login(@Body() body: LoginDto): Promise<LoginResponse> {
    const usuario = await this.auth.validarCredenciais(body.login, body.senha);
    if (!usuario) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return { token: this.auth.emitirToken(usuario), usuario };
  }

  @Get('me')
  me(@UsuarioAtual() usuario: UsuarioAutenticado): UsuarioDTO {
    return usuario;
  }

  /**
   * Troca da PRÓPRIA senha (2026-08-18) — a única ação que um barbeiro
   * não-admin tem em Ajustes. Antes só existia o reset pelo admin
   * (`PUT /barbeiros/:id/credenciais`), o que obrigava o barbeiro a pedir pro
   * dono toda vez que quisesse trocar.
   *
   * Exige a senha ATUAL: sem isso, uma sessão roubada (ou um celular
   * destravado esquecido no balcão) trocaria a senha e trancaria o próprio
   * dono pra fora da conta. Reusa `validarCredenciais` — a mesma verificação
   * do login, nenhuma segunda implementação de conferência de senha.
   */
  @Put('senha')
  async trocarSenha(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: TrocarSenhaDto,
  ): Promise<{ ok: true }> {
    const barbeiro = await this.prisma.barbeiro.findUnique({ where: { id: usuario.barbeiroId } });
    if (!barbeiro?.login) {
      throw new BadRequestException('Sua conta não tem login definido — peça ao admin.');
    }
    const confere = await this.auth.validarCredenciais(barbeiro.login, body.senhaAtual);
    if (!confere) {
      throw new UnauthorizedException('Senha atual incorreta');
    }
    if (body.novaSenha === body.senhaAtual) {
      throw new BadRequestException('A nova senha precisa ser diferente da atual');
    }
    await this.prisma.barbeiro.update({
      where: { id: barbeiro.id },
      data: { senhaHash: hashSenha(body.novaSenha) },
    });
    return { ok: true };
  }
}
