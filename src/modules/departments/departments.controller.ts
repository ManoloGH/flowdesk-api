import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private depts: DepartmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todos los departamentos de mi empresa (árbol jerárquico)' })
  findAll(@TenantId() tenantId: string) {
    return this.depts.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver departamento con sus miembros' })
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.depts.findOne(id, tenantId);
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({ summary: '[Owner/Admin] Crear departamento (o sub-departamento)' })
  create(@TenantId() tenantId: string, @Body() dto: CreateDepartmentDto) {
    return this.depts.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: '[Owner/Admin] Actualizar departamento' })
  update(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: UpdateDepartmentDto) {
    return this.depts.update(id, tenantId, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner/Admin] Eliminar departamento (solo si está vacío)' })
  remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.depts.remove(id, tenantId);
  }
}
