import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { BusinessRulesService } from './business-rules.service';
import { CreateBusinessRuleDto, UpdateBusinessRuleDto, ImportRulesFromTextDto } from './dto/business-rule.dto';

@ApiTags('Proyectos SOC — Reglas de Negocio')
@ApiBearerAuth()
@Controller('proyectos-soc/business-rules')
export class BusinessRulesController {
  constructor(private service: BusinessRulesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar reglas de negocio activas' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'active_only', required: false, type: Boolean })
  findAll(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('active_only') active_only?: string,
  ) {
    const is_active = active_only === 'true' ? true : active_only === 'false' ? false : undefined;
    return this.service.findAll(req.user.tenant_id, { category, is_active });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una regla de negocio' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.tenant_id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear regla de negocio manualmente' })
  create(@Request() req: any, @Body() dto: CreateBusinessRuleDto) {
    return this.service.create(req.user.tenant_id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar regla de negocio' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateBusinessRuleDto) {
    return this.service.update(req.user.tenant_id, id, dto);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Activar / desactivar regla' })
  toggleActive(@Request() req: any, @Param('id') id: string) {
    return this.service.toggleActive(req.user.tenant_id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar regla de negocio' })
  delete(@Request() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.tenant_id, id);
  }

  @Post('import')
  @ApiOperation({ summary: 'Importar reglas de texto con IA' })
  importFromText(@Request() req: any, @Body() dto: ImportRulesFromTextDto) {
    return this.service.importFromText(req.user.tenant_id, dto);
  }
}
