import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SocCatalogService } from './soc-catalog.service';
import { CreateSocServiceDto, UpdateSocServiceDto } from './dto/soc.dto';

@ApiTags('SOC — Catálogo de servicios')
@ApiBearerAuth()
@Controller('soc/services')
export class SocCatalogController {
  constructor(private service: SocCatalogService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Catálogo agrupado por departamento (vista solicitante)' })
  getCatalog(@Request() req: any) {
    return this.service.getCatalogGrouped(req.user.tenant_id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar servicios con filtros (admin)' })
  @ApiQuery({ name: 'department_id', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'active_only', required: false, type: Boolean })
  listServices(
    @Query('department_id') department_id: string,
    @Query('category') category: string,
    @Query('active_only') active_only: string,
    @Request() req: any,
  ) {
    return this.service.listServices(req.user.tenant_id, {
      department_id,
      category,
      active_only: active_only !== 'false',
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un servicio' })
  getService(@Param('id') id: string, @Request() req: any) {
    return this.service.getService(req.user.tenant_id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un servicio en el catálogo (admin del departamento)' })
  createService(@Body() dto: CreateSocServiceDto, @Request() req: any) {
    return this.service.createService(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un servicio (admin del departamento)' })
  updateService(
    @Param('id') id: string,
    @Body() dto: UpdateSocServiceDto,
    @Request() req: any,
  ) {
    return this.service.updateService(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desactivar un servicio (admin del departamento)' })
  deactivateService(@Param('id') id: string, @Request() req: any) {
    return this.service.deactivateService(req.user.tenant_id, req.user.slot_id, id);
  }
}
