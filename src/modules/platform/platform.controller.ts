import { Controller, Get, Post, Patch, Param, Body, Request, BadRequestException, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsEmail } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { PlatformService } from './platform.service';

// ─── DTOs inline ─────────────────────────────────────────────────────────────

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

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('Platform & Network')
@ApiBearerAuth()
@Controller()
export class PlatformController {
  private readonly logger = new Logger(PlatformController.name);
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
  async provisionTenant(@Body() dto: ProvisionTenantDto, @Request() req: any) {
    try {
      return await this.service.provisionTenant(req.user.tenant_id, dto);
    } catch (err: any) {
      this.logger.error('provisionTenant failed', err?.message, err?.stack);
      throw new BadRequestException(err?.message ?? 'Error al provisionar tenant');
    }
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
