import { Controller, Post, Get, Body, Req, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterSuperAdminDto, ChangePasswordDto } from './dto/register.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/tenant.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('setup')
  @ApiOperation({ summary: 'Crear super-admin de FlowDesk (solo primera vez)' })
  setup(@Body() dto: RegisterSuperAdminDto) {
    return this.authService.registerSuperAdmin(dto);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login de empleado o admin' })
  login(@Body() dto: LoginDto, @Request() req: any) {
    return this.authService.login(dto, req.ip);
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token usando refresh token' })
  refresh(@Body('refresh_token') token: string) {
    return this.authService.refresh(token);
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar sesión (pone status en OFFLINE)' })
  logout(@CurrentUser() user: any) {
    return this.authService.logout(user.slot_id);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Datos del usuario actual con su empresa y departamento' })
  me(@CurrentUser() user: any) {
    return this.authService.me(user.slot_id);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar contraseña' })
  changePassword(@CurrentUser() user: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.slot_id, dto);
  }
}
