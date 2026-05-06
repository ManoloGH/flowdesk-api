import { Controller, Post, Body, Headers, HttpCode, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';
import { MessagesGateway } from '../messages/messages.gateway';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private service: WebhooksService,
    private messagesGateway: MessagesGateway,
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
    await this.service.handleEvolution(payload, this.messagesGateway);
    return { ok: true };
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
}
