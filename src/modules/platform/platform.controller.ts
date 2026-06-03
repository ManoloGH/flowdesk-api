import { Controller, Get, Post, Patch, Param, Body, Request, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsEmail } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { PlatformService } from './platform.service';

class ProvisionTenantDto {
  @IsString()  name: string;
  @IsString()  slug: string;
  @IsIn(['NETWORK', 'BRANCH'])  tenant_type: 'NETWORK' | 'BRANCH';
  @IsOptional() @IsString()  network_id?: string;
  @IsOptional() @IsString()  external_ref?: string;
  @IsOptional() @IsString()  plan?: string;
  @IsEmail()   owner_email: string;
  @IsString()  owner_name: string;
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
  @IsIn(['starter', 'professional', 'enterprise', 'internal']) plan: string;
}

@ApiTags('Platform & Network')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  private readonly logger = new Logger(PlatformController.name);
  constructor(private service: PlatformService) {}

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
