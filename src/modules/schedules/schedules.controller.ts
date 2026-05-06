import { Controller, Get, Post, Patch, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/schedule.dto';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Schedules (Horarios)')
@ApiBearerAuth()
@Controller('schedules')
export class SchedulesController {
  constructor(private schedules: SchedulesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar horarios de mi empresa' })
  findAll(@TenantId() tenantId: string) {
    return this.schedules.findAll(tenantId);
  }

  @Post()
  @Roles('owner', 'admin')
  @ApiOperation({ summary: '[Owner/Admin] Crear horario laboral' })
  create(@TenantId() tenantId: string, @Body() dto: CreateScheduleDto) {
    return this.schedules.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: '[Owner/Admin] Actualizar horario' })
  update(@Param('id') id: string, @TenantId() tenantId: string, @Body() dto: Partial<CreateScheduleDto>) {
    return this.schedules.update(id, tenantId, dto);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner/Admin] Eliminar horario' })
  remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.schedules.remove(id, tenantId);
  }
}
