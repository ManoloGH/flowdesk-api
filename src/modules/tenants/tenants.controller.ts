import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus, Header, Res } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto, UpdateTenantStatusDto, UpdateTenantTypeDto } from './dto/update-tenant.dto';
import { CurrentUser, TenantId } from '../../common/decorators/tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Tenants (Empresas)')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get()
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] Listar todas las empresas' })
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get('mine')
  @ApiOperation({ summary: 'Ver mi empresa (cualquier usuario autenticado)' })
  findMine(@TenantId() tenantId: string) {
    return this.tenantsService.findMine(tenantId);
  }

  @Get('mine/stats')
  @ApiOperation({ summary: 'Stats de mi empresa: usuarios online, departamentos, onboarding' })
  myStats(@TenantId() tenantId: string) {
    return this.tenantsService.stats(tenantId);
  }

  @Get('mine/usage')
  @ApiOperation({ summary: 'Consumo de tokens IA del mes actual vs límite del plan' })
  myUsage(@TenantId() tenantId: string) {
    return this.tenantsService.tokenUsage(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver empresa por ID (super-admin ve cualquiera, owner solo la suya)' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.tenantsService.findOne(id, user.tenant_id, user.role);
  }

  @Post()
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] Crear nueva empresa con su owner' })
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  @Patch('mine')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: '[Owner/Admin] Actualizar datos de mi empresa (logo, color, nombre)' })
  updateMine(@TenantId() tenantId: string, @CurrentUser() user: any, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(tenantId, dto, user.tenant_id, user.role);
  }

  @Patch(':id/status')
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] Activar, suspender o cancelar empresa' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.tenantsService.updateStatus(id, dto);
  }

  @Patch(':id/type')
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] Cambiar tipo de tenant (PLATFORM / NETWORK / BRANCH)' })
  updateType(@Param('id') id: string, @Body() dto: UpdateTenantTypeDto) {
    return this.tenantsService.updateType(id, dto);
  }

  @Delete(':id')
  @Roles('superadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Super-admin] Eliminar empresa y todos sus datos' })
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }

  @Get(':id/slots')
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] Listar usuarios humanos de una empresa' })
  listTenantSlots(@Param('id') id: string) {
    return this.tenantsService.listTenantSlots(id);
  }

  @Post(':id/slots/:slotId/reset-password')
  @Roles('superadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Super-admin] Generar nueva contraseña para un usuario' })
  resetSlotPassword(@Param('id') id: string, @Param('slotId') slotId: string) {
    return this.tenantsService.resetSlotPassword(id, slotId);
  }

  @Get(':id/integrations-summary')
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] Ver estado de integraciones de una empresa' })
  listTenantIntegrations(@Param('id') id: string) {
    return this.tenantsService.listTenantIntegrations(id);
  }

  @Get(':id/export')
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] Exportar todos los datos de una empresa como JSON descargable' })
  @Header('Content-Type', 'application/json')
  async exportTenant(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.tenantsService.exportTenant(id);
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', `attachment; filename="flowdesk-export-${id}-${date}.json"`);
    return data;
  }

  @Post(':id/restore')
  @Roles('superadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Super-admin] Restaurar datos de una empresa desde un export JSON' })
  restoreTenant(@Param('id') id: string, @Body() exportData: any) {
    return this.tenantsService.restoreTenant(id, exportData);
  }
}
