import { Controller, Post, Get, Body, Headers, HttpCode, HttpException, HttpStatus, Logger, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';
import { MessagesGateway } from '../messages/messages.gateway';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private service: WebhooksService,
    private messagesGateway: MessagesGateway,
    private evolutionAdapter: EvolutionAdapter,
  ) {}

  @Post('chatwoot')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receptor de eventos de Chatwoot' })
  async chatwoot(@Body() payload: any, @Headers() headers: any) {
    // Verificación de firma opcional (recomendado en producción)
    await this.service.handleChatwoot(payload, this.messagesGateway);
    return { ok: true };
  }

  @Post('evolution')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receptor de eventos de Evolution API (WhatsApp)' })
  async evolution(@Body() payload: any) {
    this.logger.log(`Evolution webhook: instance=${payload?.instance ?? 'N/A'} event=${payload?.event ?? 'N/A'}`);
    await this.service.handleEvolution(payload, this.messagesGateway);
    return { ok: true };
  }

  @Get('evolution-check/:instance')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '[Debug] Consulta el webhook config de una instancia Evolution' })
  async evolutionCheck(@Param('instance') instance: string) {
    const config = await this.evolutionAdapter.getWebhook(instance);
    return { instance, config };
  }

  @Post('ghl')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Receptor de eventos de GoHighLevel' })
  async ghl(@Body() payload: any) {
    await this.service.handleGhl(payload, this.messagesGateway);
    return { ok: true };
  }

  @Post('provision-tenant')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Provisionamiento de tenant desde Airtable (Propuesta Ganada)' })
  async provisionTenant(
    @Headers('x-flowdesk-secret') secret: string,
    @Body() body: any,
  ) {
    try {
      return await this.service.provisionFromAirtable(secret ?? '', body);
    } catch (err: any) {
      throw new HttpException(err.message ?? 'Error al provisionar tenant', err.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('migrate-employee-structure')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '[MentorIA] Migra todos los tenants al sistema de 4 niveles de empleados (idempotente)' })
  async migrateEmployeeStructure(
    @Headers('x-flowdesk-secret') secret: string,
    @Body() body: { tenant_id?: string },
  ) {
    try {
      return await this.service.migrateEmployeeStructure(secret ?? '', body?.tenant_id);
    } catch (err: any) {
      throw new HttpException(err.message ?? 'Error en migración', err.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('run-bot-migration')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '[Admin] Crea tablas bot_conversations y bot_messages si no existen' })
  async runBotMigration(@Headers('x-flowdesk-secret') secret: string) {
    if (secret !== process.env.ENCRYPTION_KEY) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    return await this.service.runBotMigration();
  }
}
