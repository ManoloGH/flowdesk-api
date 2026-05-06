import { Controller, Get, Post, Patch, Param, Body, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PlatformService } from './platform.service';

// ─── DTOs inline ─────────────────────────────────────────────────────────────

class ProvisionTenantDto {
  name: string;
  slug: string;
  tenant_type: 'NETWORK' | 'BRANCH';
  network_id?: string;
  external_ref?: string;
  airtable_project_id?: string;
  employee_desks_enabled?: boolean;
  plan?: string;
  owner_email: string;
  owner_name: string;
}

class ProvisionBranchDto {
  name: string;
  slug: string;
  external_ref?: string;
  employee_desks_enabled?: boolean;
  owner_email: string;
  owner_name: string;
}

class SetAccessDto {
  access: 'FULL' | 'LIGHT' | 'NONE';
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('Platform & Network')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  constructor(private service: PlatformService) {}

  // ── PLATFORM endpoints (solo tenant_type = PLATFORM) ──────────────────────

  @Get('platform/network')
  @ApiOperation({ summary: '[PLATFORM] Vista global de toda la red de desks' })
  getNetwork(@Request() req: any) {
    return this.service.getNetwork(req.user.tenant_id);
  }

  @Get('platform/network/:tenantId')
  @ApiOperation({ summary: '[PLATFORM] Detalle y health de un desk específico' })
  getTenantDetail(@Param('tenantId') tenantId: string, @Request() req: any) {
    return this.service.getTenantDetail(req.user.tenant_id, tenantId);
  }

  @Post('platform/network')
  @ApiOperation({ summary: '[PLATFORM] Provisionar un nuevo tenant (NETWORK o BRANCH)' })
  provisionTenant(@Body() dto: ProvisionTenantDto, @Request() req: any) {
    return this.service.provisionTenant(req.user.tenant_id, dto);
  }

  // ── NETWORK endpoints (tenant_type = NETWORK o PLATFORM) ──────────────────

  @Get('network/branches')
  @ApiOperation({ summary: '[NETWORK] Lista de sucursales propias con health scores' })
  getMyBranches(@Request() req: any) {
    return this.service.getMyBranches(req.user.tenant_id);
  }

  @Post('network/branches')
  @ApiOperation({ summary: '[NETWORK] Provisionar una nueva sucursal' })
  provisionBranch(@Body() dto: ProvisionBranchDto, @Request() req: any) {
    return this.service.provisionBranch(req.user.tenant_id, dto);
  }

  // ── EMPLOYEE ACCESS endpoints ──────────────────────────────────────────────

  @Patch('team-slots/:slotId/desk-access')
  @ApiOperation({ summary: 'Configurar nivel de acceso al desk de un empleado (FULL/LIGHT/NONE)' })
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
