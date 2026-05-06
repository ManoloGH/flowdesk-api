import {
  Controller, Get, Post, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { CurrentUser, TenantId } from '../../common/decorators/tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Branches (Sucursales)')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private branches: BranchesService) {}

  @Get()
  @Roles('owner', 'admin', 'superadmin')
  @ApiOperation({ summary: 'Listar sucursales de mi empresa (NETWORK/PLATFORM)' })
  list(@TenantId() tenantId: string) {
    return this.branches.list(tenantId);
  }

  @Post()
  @Roles('owner', 'admin', 'superadmin')
  @ApiOperation({ summary: 'Crear nueva sucursal bajo mi empresa' })
  create(@Body() dto: CreateBranchDto, @TenantId() tenantId: string) {
    return this.branches.create(dto, tenantId);
  }

  @Get(':id/stats')
  @Roles('owner', 'admin', 'superadmin')
  @ApiOperation({ summary: 'Stats de una sucursal específica' })
  stats(@Param('id') id: string, @CurrentUser() user: any) {
    return this.branches.stats(id, user.tenant_id, user.role);
  }

  @Post(':id/enter')
  @Roles('owner', 'admin', 'superadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Obtener JWT temporal con contexto de la sucursal' })
  enter(@Param('id') id: string, @CurrentUser() user: any) {
    return this.branches.enter(id, user.tenant_id, user.role, user.sub, user.email);
  }
}
