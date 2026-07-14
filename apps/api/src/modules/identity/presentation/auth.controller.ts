import { Body, Controller, Get, Inject, Post, UnauthorizedException } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { LoginResponse, UsuarioDTO } from '@bigods/contracts';
import { AUTH_PROVIDER, AuthProvider, UsuarioAutenticado } from '../domain/auth-provider';
import { Publico, UsuarioAtual } from './auth.decorators';

class LoginDto {
  @IsString() login!: string;
  @IsString() @MinLength(4) senha!: string;
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AUTH_PROVIDER) private readonly auth: AuthProvider) {}

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
}
