import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { WebProyectosService } from './web-proyectos.service';
import { CreateWebProyectoDto, UpdateWebProyectoDto } from './dto/web-proyecto.dto';

@ApiTags('Web Builder')
@ApiBearerAuth()
@Controller()
export class WebProyectosController {
  constructor(private service: WebProyectosService) {}

  @Post('web-proyectos')
  @ApiOperation({ summary: 'Crear proyecto web de cliente' })
  create(@Body() dto: CreateWebProyectoDto, @Request() req: any) {
    return this.service.create(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('web-proyectos')
  @ApiOperation({ summary: 'Listar proyectos web' })
  @ApiQuery({ name: 'fase', required: false })
  findAll(@Query('fase') fase: string, @Request() req: any) {
    return this.service.findAll(req.user.tenant_id, fase);
  }

  @Get('web-proyectos/stats')
  @ApiOperation({ summary: 'Conteo de proyectos por fase' })
  stats(@Request() req: any) {
    return this.service.stats(req.user.tenant_id);
  }

  @Get('web-proyectos/:id')
  @ApiOperation({ summary: 'Ver proyecto web' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.service.findOne(req.user.tenant_id, id);
  }

  @Patch('web-proyectos/:id')
  @ApiOperation({ summary: 'Actualizar proyecto (fase, URL, assets, notas)' })
  update(@Param('id') id: string, @Body() dto: UpdateWebProyectoDto, @Request() req: any) {
    return this.service.update(req.user.tenant_id, id, dto);
  }

  @Patch('web-proyectos/:id/avanzar')
  @ApiOperation({ summary: 'Avanzar a la siguiente fase automáticamente' })
  avanzar(@Param('id') id: string, @Request() req: any) {
    return this.service.avanzarFase(req.user.tenant_id, id);
  }

  @Delete('web-proyectos/:id')
  @ApiOperation({ summary: 'Eliminar proyecto web' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(req.user.tenant_id, id);
  }
}
