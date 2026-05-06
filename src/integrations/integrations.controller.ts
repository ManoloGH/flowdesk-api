import { Controller, Get, Post, Delete, Body, Param, Request, Query, Redirect } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { Roles } from '../modules/auth/decorators/roles.decorator';
import { Public } from '../modules/auth/decorators/public.decorator';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { AuditService, AuditAction } from '../common/audit/audit.service';
import { GhlAdapter } from './ghl/ghl.adapter';
import { GoogleAdapter } from './google/google.adapter';
import { M365Adapter } from './m365/m365.adapter';

@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private prisma: PrismaService,
    private enc: EncryptionService,
    private audit: AuditService,
    private ghl: GhlAdapter,
    private google: GoogleAdapter,
    private m365: M365Adapter,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar integraciones del tenant' })
  list(@Request() req: any) {
    return this.prisma.integration.findMany({
      where: { tenant_id: req.user.tenant_id },
      select: { id: true, provider: true, status: true, created_at: true },
    });
  }

  @Post('ghl/connect')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Conectar GoHighLevel' })
  @ApiBody({ schema: { properties: { api_key: { type: 'string' }, location_id: { type: 'string' } }, required: ['api_key', 'location_id'] } })
  async connectGhl(@Body() body: { api_key: string; location_id: string }, @Request() req: any) {
    const existing = await this.prisma.integration.findFirst({
      where: { tenant_id: req.user.tenant_id, provider: 'ghl' },
    });

    const data = {
      tenant_id: req.user.tenant_id,
      provider: 'ghl',
      status: 'connected',
      config: { api_key: body.api_key, location_id: body.location_id },
    };

    if (existing) {
      return this.prisma.integration.update({ where: { id: existing.id }, data });
    }
    return this.prisma.integration.create({ data });
  }

  @Get('ghl/test')
  @ApiOperation({ summary: 'Probar conexión GHL — trae primeros contactos' })
  async testGhl(@Request() req: any) {
    const integration = await this.prisma.integration.findFirst({
      where: { tenant_id: req.user.tenant_id, provider: 'ghl', status: 'connected' },
    });
    if (!integration) return { ok: false, error: 'GHL no conectado para este tenant' };

    const result = await this.ghl.findContact('test');
    return { ok: true, integration_id: integration.id, result };
  }

  @Get('ghl/contacts')
  @ApiOperation({ summary: 'Importar TODOS los contactos de GHL a FlowDesk (paginación automática)' })
  async importContacts(@Request() req: any) {
    const tenantId = req.user.tenant_id;
    const headers = {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    };

    let allContacts: any[] = [];
    let nextPageUrl: string | null =
      `https://services.leadconnectorhq.com/contacts/?locationId=${process.env.GHL_LOCATION_ID}&limit=100`;

    while (nextPageUrl) {
      const res = await fetch(nextPageUrl, { headers });
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, status: res.status, error: err, imported_so_far: allContacts.length };
      }

      const data: any = await res.json();
      allContacts = allContacts.concat(data.contacts ?? []);

      // GHL devuelve nextPageUrl o meta.nextPageUrl según la versión
      nextPageUrl = data.meta?.nextPageUrl ?? data.nextPageUrl ?? null;
    }

    let created = 0;
    let updated = 0;

    for (const c of allContacts) {
      const existing = await this.prisma.contact.findFirst({
        where: { tenant_id: tenantId, ghl_id: c.id },
      });

      const payload = {
        first_name: c.firstName ?? 'Sin nombre',
        last_name: c.lastName ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        ghl_id: c.id,
        status: 'lead' as const,
        last_contact_at: c.dateUpdated ? new Date(c.dateUpdated) : null,
      };

      if (existing) {
        await this.prisma.contact.update({ where: { id: existing.id }, data: payload });
        updated++;
      } else {
        await this.prisma.contact.create({ data: { tenant_id: tenantId, ...payload } });
        created++;
      }
    }

    return { ok: true, total: allContacts.length, created, updated };
  }

  // ─── Google OAuth ─────────────────────────────────────────────────────────────

  @Get('google/connect-url')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Obtener URL OAuth de Google como JSON (para apps desktop/Electron)' })
  googleConnectUrl(@Request() req: any) {
    const state = Buffer.from(JSON.stringify({ tenantId: req.user.tenant_id, slotId: req.user.slot_id })).toString('base64');
    return { url: this.google.getAuthUrl(state) };
  }

  @Get('google/connect')
  @Roles('owner', 'admin')
  @Redirect('', 302)
  @ApiOperation({ summary: 'Iniciar OAuth con Google — redirect directo (para flujo web)' })
  connectGoogle(@Request() req: any) {
    const state = Buffer.from(JSON.stringify({ tenantId: req.user.tenant_id, slotId: req.user.slot_id })).toString('base64');
    return { url: this.google.getAuthUrl(state) };
  }

  @Get('google/callback')
  @Public()
  @Redirect('', 302)
  @ApiOperation({ summary: 'Callback OAuth Google — intercambia código y guarda tokens' })
  async googleCallback(@Query('code') code: string, @Query('state') state: string) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    try {
      const { tenantId, slotId } = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      const tokens = await this.google.exchangeCode(code);
      if (!tokens) return { url: `${frontendUrl}/integrations?error=google_auth_failed` };

      const existing = await this.prisma.integration.findFirst({
        where: { tenant_id: tenantId, owner_slot_id: slotId, provider: 'google' },
      });
      const integrationData = {
        tenant_id: tenantId,
        owner_slot_id: slotId,
        integration_scope: 'personal',
        provider: 'google',
        status: 'connected',
        credentials_enc: this.enc.encrypt(JSON.stringify({ refresh_token: tokens.refresh_token, email: tokens.email })),
        connected_at: new Date(),
      };
      if (existing) {
        await this.prisma.integration.update({ where: { id: existing.id }, data: integrationData });
      } else {
        await this.prisma.integration.create({ data: integrationData });
      }
      this.audit.log({
        tenantId,
        actorId: slotId,
        action: AuditAction.INTEGRATION_CONNECTED,
        resourceType: 'integration',
        payload: { provider: 'google', email: tokens.email },
      });
      return { url: `${frontendUrl}/integrations?success=google` };
    } catch {
      return { url: `${frontendUrl}/integrations?error=google_callback_error` };
    }
  }

  @Get('google/test')
  @ApiOperation({ summary: 'Verificar conexión Google — trae eventos de hoy' })
  async testGoogle(@Request() req: any) {
    const integration = await this.prisma.integration.findFirst({
      where: { tenant_id: req.user.tenant_id, owner_slot_id: req.user.slot_id, provider: 'google', status: 'connected' },
    });
    if (!integration?.credentials_enc) return { ok: false, error: 'Google no conectado' };
    const creds = JSON.parse(this.enc.safeDecrypt(integration.credentials_enc));
    const accessToken = await this.google.getAccessToken(creds.refresh_token);
    if (!accessToken) return { ok: false, error: 'No se pudo refrescar el token de Google' };
    const now = new Date();
    const start = new Date(now.setHours(0, 0, 0, 0)).toISOString();
    const end = new Date(now.setHours(23, 59, 59, 999)).toISOString();
    const events = await this.google.getCalendarEvents(accessToken, start, end);
    return { ok: true, email: creds.email, today_events: events.items?.length ?? 0 };
  }

  // ─── Microsoft 365 OAuth ───────────────────────────────────────────────────

  @Get('microsoft/connect-url')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Obtener URL OAuth de Microsoft 365 como JSON (para apps desktop/Electron)' })
  microsoftConnectUrl(@Request() req: any) {
    const state = Buffer.from(JSON.stringify({ tenantId: req.user.tenant_id, slotId: req.user.slot_id })).toString('base64');
    return { url: this.m365.getAuthUrl(state) };
  }

  @Get('microsoft/connect')
  @Roles('owner', 'admin')
  @Redirect('', 302)
  @ApiOperation({ summary: 'Iniciar OAuth con Microsoft 365 (Outlook + Teams)' })
  connectMicrosoft(@Request() req: any) {
    const state = Buffer.from(JSON.stringify({ tenantId: req.user.tenant_id, slotId: req.user.slot_id })).toString('base64');
    return { url: this.m365.getAuthUrl(state) };
  }

  @Get('microsoft/callback')
  @Public()
  @Redirect('', 302)
  @ApiOperation({ summary: 'Callback OAuth Microsoft — intercambia código y guarda tokens' })
  async microsoftCallback(@Query('code') code: string, @Query('state') state: string) {
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    try {
      const { tenantId, slotId } = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      const tokens = await this.m365.exchangeCode(code);
      if (!tokens) return { url: `${frontendUrl}/integrations?error=microsoft_auth_failed` };

      const existing = await this.prisma.integration.findFirst({
        where: { tenant_id: tenantId, owner_slot_id: slotId, provider: 'microsoft365' },
      });
      const integrationData = {
        tenant_id: tenantId,
        owner_slot_id: slotId,
        integration_scope: 'personal',
        provider: 'microsoft365',
        status: 'connected',
        credentials_enc: this.enc.encrypt(JSON.stringify({ refresh_token: tokens.refresh_token, email: tokens.email })),
        connected_at: new Date(),
      };
      if (existing) {
        await this.prisma.integration.update({ where: { id: existing.id }, data: integrationData });
      } else {
        await this.prisma.integration.create({ data: integrationData });
      }
      this.audit.log({
        tenantId,
        actorId: slotId,
        action: AuditAction.INTEGRATION_CONNECTED,
        resourceType: 'integration',
        payload: { provider: 'microsoft365', email: tokens.email },
      });
      return { url: `${frontendUrl}/integrations?success=microsoft` };
    } catch {
      return { url: `${frontendUrl}/integrations?error=microsoft_callback_error` };
    }
  }

  @Get('microsoft/test')
  @ApiOperation({ summary: 'Verificar conexión Microsoft 365 — trae eventos de hoy' })
  async testMicrosoft(@Request() req: any) {
    const integration = await this.prisma.integration.findFirst({
      where: { tenant_id: req.user.tenant_id, owner_slot_id: req.user.slot_id, provider: 'microsoft365', status: 'connected' },
    });
    if (!integration?.credentials_enc) return { ok: false, error: 'Microsoft 365 no conectado' };
    const creds = JSON.parse(this.enc.safeDecrypt(integration.credentials_enc));
    const accessToken = await this.m365.getAccessToken(creds.refresh_token);
    if (!accessToken) return { ok: false, error: 'No se pudo refrescar el token de Microsoft' };
    const now = new Date();
    const start = new Date(now.setHours(0, 0, 0, 0)).toISOString();
    const end = new Date(now.setHours(23, 59, 59, 999)).toISOString();
    const events = await this.m365.getCalendarEvents(accessToken, start, end);
    return { ok: true, email: creds.email, today_events: events.value?.length ?? 0 };
  }

  // ─── Disconnect ────────────────────────────────────────────────────────────

  @Delete(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Desconectar integración' })
  async disconnect(@Param('id') id: string, @Request() req: any) {
    const integration = await this.prisma.integration.findFirst({
      where: { id, tenant_id: req.user.tenant_id },
      select: { provider: true },
    });
    await this.prisma.integration.updateMany({
      where: { id, tenant_id: req.user.tenant_id },
      data: { status: 'disconnected' },
    });
    if (integration) {
      this.audit.log({
        tenantId: req.user.tenant_id,
        actorId: req.user.slot_id,
        action: AuditAction.INTEGRATION_DISCONNECTED,
        resourceType: 'integration',
        resourceId: id,
        payload: { provider: integration.provider },
      });
    }
    return { disconnected: true };
  }
}
