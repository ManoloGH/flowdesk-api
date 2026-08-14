import { Controller, Get, Post, Patch, Delete, Param, Body, Request, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsEmail, MinLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { PlatformService } from './platform.service';
import { MigrationAuditService } from './migration-audit.service';

class ProvisionTenantDto {
  @IsString()  name: string;
  @IsString()  slug: string;
  @IsIn(['NETWORK', 'BRANCH'])  tenant_type: 'NETWORK' | 'BRANCH';
  @IsOptional() @IsString()  network_id?: string;
  @IsOptional() @IsString()  external_ref?: string;
  @IsOptional() @IsString()  plan?: string;
  @IsOptional() @IsString()  account_type?: string;
  @IsEmail()   owner_email: string;
  @IsString()  owner_name: string;
  @IsOptional() modules_config?: any[];
}

class ProvisionBranchDto {
  @IsString()   name: string;
  @IsString()   slug: string;
  @IsOptional() @IsString()   external_ref?: string;
  @IsOptional() employee_desks_enabled?: boolean;
  @IsEmail()    owner_email: string;
  @IsString()   owner_name: string;
}

class SetAccessDto {
  @IsIn(['FULL', 'LIGHT', 'NONE']) access: 'FULL' | 'LIGHT' | 'NONE';
}

class UpdateStatusDto {
  @IsIn(['active', 'suspended', 'cancelled']) status: 'active' | 'suspended' | 'cancelled';
}

class UpdatePlanDto {
  @IsIn(['nano', 'small', 'medium', 'large', 'enterprise', 'starter', 'professional', 'internal']) plan: string;
}

class UpdateAccountTypeDto {
  @IsString() account_type: string;
}

class PingRemoteDto {
  @IsString() self_hosted_url: string;
}

class MarkMigratedDto {
  @IsString() self_hosted_url: string;
}

class CreateTenantSlotDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() role?: string;
  @IsOptional() @IsString() worker_type?: string;
  @IsOptional() @IsString() password?: string;
}

@ApiTags('Platform & Network')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  private readonly logger = new Logger(PlatformController.name);
  constructor(
    private service: PlatformService,
    private audit: MigrationAuditService,
  ) {}

  // ── PLATFORM endpoints ─────────────────────────────────────────────────────

  @Get('platform/stats')
  @ApiOperation({ summary: '[PLATFORM] Estadísticas globales de la red' })
  getStats(@Request() req: any) {
    return this.service.getNetworkStats(req.user.tenant_id);
  }

  @Get('platform/network')
  @ApiOperation({ summary: '[PLATFORM] Vista global de toda la red de desks' })
  getNetwork(@Request() req: any) {
    return this.service.getNetwork(req.user.tenant_id);
  }

  @Get('platform/network/:tenantId')
  @ApiOperation({ summary: '[PLATFORM] Detalle completo de un tenant' })
  getTenantDetail(@Param('tenantId') tenantId: string, @Request() req: any) {
    return this.service.getTenantDetail(req.user.tenant_id, tenantId);
  }

  @Post('platform/network')
  @ApiOperation({ summary: '[PLATFORM] Provisionar un nuevo tenant' })
  async provisionTenant(@Body() dto: ProvisionTenantDto, @Request() req: any) {
    try {
      return await this.service.provisionTenant(req.user.tenant_id, dto);
    } catch (err: any) {
      this.logger.error('provisionTenant failed', err?.message);
      throw new BadRequestException(err?.message ?? 'Error al provisionar tenant');
    }
  }

  @Patch('platform/network/:tenantId/status')
  @ApiOperation({ summary: '[PLATFORM] Activar / suspender un tenant' })
  updateStatus(@Param('tenantId') tenantId: string, @Body() dto: UpdateStatusDto, @Request() req: any) {
    return this.service.updateStatus(req.user.tenant_id, tenantId, dto.status);
  }

  @Patch('platform/network/:tenantId/plan')
  @ApiOperation({ summary: '[PLATFORM] Cambiar plan de un tenant' })
  updatePlan(@Param('tenantId') tenantId: string, @Body() dto: UpdatePlanDto, @Request() req: any) {
    return this.service.updatePlan(req.user.tenant_id, tenantId, dto.plan);
  }

  @Patch('platform/network/:tenantId/web-builder')
  @ApiOperation({ summary: '[PLATFORM] Activar/desactivar módulo Web Builder para un tenant' })
  toggleWebBuilder(@Param('tenantId') tenantId: string, @Body() dto: { enabled: boolean }, @Request() req: any) {
    return this.service.toggleWebBuilder(req.user.tenant_id, tenantId, dto.enabled);
  }

  @Patch('platform/network/:tenantId/communications')
  @ApiOperation({ summary: '[PLATFORM] Activar/desactivar Central de Comunicaciones para un tenant' })
  toggleCommunications(@Param('tenantId') tenantId: string, @Body() dto: { enabled: boolean }, @Request() req: any) {
    return this.service.toggleCommunications(req.user.tenant_id, tenantId, dto.enabled);
  }

  @Post('platform/network/:tenantId/impersonate')
  @ApiOperation({ summary: '[PLATFORM] Entrar como empresa (impersonation)' })
  impersonate(@Param('tenantId') tenantId: string, @Request() req: any) {
    return this.service.impersonateTenant(req.user.tenant_id, req.user.sub, tenantId);
  }

  @Patch('platform/network/:tenantId/account-type')
  @ApiOperation({ summary: '[PLATFORM] Cambiar tipo de cuenta de un tenant' })
  updateAccountType(@Param('tenantId') tenantId: string, @Body() dto: UpdateAccountTypeDto, @Request() req: any) {
    return this.service.updateAccountType(req.user.tenant_id, tenantId, dto.account_type);
  }

  @Post('platform/network/:tenantId/migration-bundle')
  @ApiOperation({ summary: '[PLATFORM] Generar bundle de migración a servidor propio' })
  generateMigrationBundle(@Param('tenantId') tenantId: string, @Request() req: any) {
    return this.service.generateMigrationBundle(req.user.tenant_id, tenantId);
  }

  @Get('platform/network/:tenantId/migration-audit')
  @ApiOperation({ summary: '[PLATFORM] Auditoría pre-migración: integridad y completitud de datos' })
  async runMigrationAudit(@Param('tenantId') tenantId: string, @Request() req: any) {
    await this.service.assertPlatformAccess(req.user.tenant_id);
    return this.audit.runPreMigrationAudit(tenantId);
  }

  @Post('platform/network/:tenantId/migration-ping')
  @ApiOperation({ summary: '[PLATFORM] Verificar que el servidor destino responde' })
  async pingRemote(@Param('tenantId') tenantId: string, @Body() dto: PingRemoteDto, @Request() req: any) {
    await this.service.assertPlatformAccess(req.user.tenant_id);
    const result = await this.audit.pingRemoteInstance(dto.self_hosted_url);
    if (result.reachable) {
      await this.service.setMigratedUrl(tenantId, dto.self_hosted_url);
    }
    return result;
  }

  @Patch('platform/network/:tenantId/migration-status')
  @ApiOperation({ summary: '[PLATFORM] Marcar tenant como migrado al servidor propio' })
  async markMigrated(@Param('tenantId') tenantId: string, @Body() dto: MarkMigratedDto, @Request() req: any) {
    await this.service.assertPlatformAccess(req.user.tenant_id);
    return this.service.setMigratedUrl(tenantId, dto.self_hosted_url);
  }

  @Post('platform/network/:tenantId/team-slots')
  @ApiOperation({ summary: '[PLATFORM] Crear usuario para un tenant' })
  async createTenantSlot(@Param('tenantId') tenantId: string, @Body() dto: CreateTenantSlotDto, @Request() req: any) {
    try {
      return await this.service.createTenantSlot(req.user.tenant_id, tenantId, dto);
    } catch (err: any) {
      throw new BadRequestException(err?.message ?? 'Error al crear usuario');
    }
  }

  @Delete('platform/network/:tenantId/team-slots/:slotId')
  @ApiOperation({ summary: '[PLATFORM] Eliminar usuario de un tenant' })
  async deleteTenantSlot(
    @Param('tenantId') tenantId: string,
    @Param('slotId') slotId: string,
    @Request() req: any,
  ) {
    try {
      return await this.service.deleteTenantSlot(req.user.tenant_id, slotId);
    } catch (err: any) {
      throw new BadRequestException(err?.message ?? 'Error al eliminar usuario');
    }
  }

  // ── NETWORK endpoints ──────────────────────────────────────────────────────

  @Get('network/branches')
  @ApiOperation({ summary: '[NETWORK] Lista de sucursales propias' })
  getMyBranches(@Request() req: any) {
    return this.service.getMyBranches(req.user.tenant_id);
  }

  @Post('network/branches')
  @ApiOperation({ summary: '[NETWORK] Provisionar una nueva sucursal' })
  provisionBranch(@Body() dto: ProvisionBranchDto, @Request() req: any) {
    return this.service.provisionBranch(req.user.tenant_id, dto);
  }

  // ── EMPLOYEE ACCESS ────────────────────────────────────────────────────────

  @Patch('team-slots/:slotId/desk-access')
  @ApiOperation({ summary: 'Configurar nivel de acceso al desk de un empleado' })
  setAccess(@Param('slotId') slotId: string, @Body() dto: SetAccessDto, @Request() req: any) {
    return this.service.setEmployeeAccess(req.user.tenant_id, slotId, dto.access);
  }

  @Public()
  @Get('light-access/:token')
  @ApiOperation({ summary: 'Resolver token de acceso ligero (sin auth JWT)' })
  getLightAccess(@Param('token') token: string) {
    return this.service.getLightAccessLink(token);
  }
}
