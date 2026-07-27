import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { RequirementsService } from './requirements.service';
import { CreateRequirementDto, UpdateRequirementDto, UpdateRequirementStatusDto, GenerateRequirementDocDto } from './dto/requirement.dto';

@ApiTags('Proyectos SOC — Requerimientos')
@ApiBearerAuth()
@Controller('proyectos-soc/requirements')
export class RequirementsController {
  constructor(private service: RequirementsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar requerimientos del tenant' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'doc_type', required: false })
  findAll(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('doc_type') doc_type?: string,
  ) {
    return this.service.findAll(req.user.tenant_id, { status, doc_type });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle de un requerimiento' })
  findOne(@Request() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.tenant_id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear requerimiento (intake manual)' })
  create(@Request() req: any, @Body() dto: CreateRequirementDto) {
    return this.service.create(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar datos del requerimiento' })
  update(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateRequirementDto) {
    return this.service.update(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar estado del requerimiento' })
  updateStatus(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateRequirementStatusDto) {
    return this.service.updateStatus(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Post(':id/generate')
  @ApiOperation({ summary: 'Generar / enriquecer documento ISO con IA' })
  generateDocument(@Request() req: any, @Param('id') id: string, @Body() dto: GenerateRequirementDocDto) {
    return this.service.generateDocument(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Get(':id/document-html')
  @ApiOperation({ summary: 'Obtener HTML del documento R-ISO generado por IA' })
  getDocumentHtml(@Request() req: any, @Param('id') id: string) {
    return this.service.getDocumentHtml(req.user.tenant_id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar requerimiento' })
  delete(@Request() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.tenant_id, id);
  }
}
