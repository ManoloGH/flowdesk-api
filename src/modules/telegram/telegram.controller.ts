import { Controller, Post, Get, Delete, Body, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TelegramService } from './telegram.service';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Telegram')
@Controller('telegram')
export class TelegramController {
  constructor(private telegramService: TelegramService) {}

  // Webhook de Telegram — público, sin JWT
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook de Telegram (uso interno)' })
  webhook(@Body() body: any) {
    this.telegramService.handleWebhook(body).catch(() => {});
    return { ok: true };
  }

  // Generar código de vinculación
  @ApiBearerAuth()
  @Post('connect')
  @ApiOperation({ summary: 'Generar código para vincular cuenta de Telegram' })
  connect(@Request() req: any) {
    return this.telegramService.generateConnectCode(req.user.slot_id, req.user.tenant_id);
  }

  // Estado de la conexión
  @ApiBearerAuth()
  @Get('status')
  @ApiOperation({ summary: 'Ver si Telegram está vinculado' })
  status(@Request() req: any) {
    return this.telegramService.getStatus(req.user.slot_id);
  }

  // Desvincular
  @ApiBearerAuth()
  @Delete('disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desvincular cuenta de Telegram' })
  disconnect(@Request() req: any) {
    return this.telegramService.disconnect(req.user.slot_id);
  }

  // Registrar webhook con Telegram (llamar una vez al desplegar)
  @ApiBearerAuth()
  @Post('setup-webhook')
  @ApiOperation({ summary: '[Admin] Registrar webhook URL con Telegram' })
  setupWebhook(@Body('url') url: string) {
    return this.telegramService.setupWebhook(url);
  }
}
