import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { MapPropsService } from './map-props.service';
import { CreateMapPropDto, UpdateMapPropDto, UpdateCampusConfigDto } from './dto/map-prop.dto';

@ApiTags('Campus & Map Props')
@ApiBearerAuth()
@Controller()
export class MapPropsController {
  constructor(private service: MapPropsService) {}

  // ─── Campus config ────────────────────────────────────────────────────────

  @Get('campus/config')
  @ApiOperation({ summary: 'Obtener configuración del campus (mapa, template, colores)' })
  getConfig(@Request() req: any) {
    return this.service.getCampusConfig(req.user.tenant_id);
  }

  @Patch('campus/config')
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Actualizar configuración del campus' })
  updateConfig(@Body() dto: UpdateCampusConfigDto, @Request() req: any) {
    return this.service.updateCampusConfig(req.user.tenant_id, dto);
  }

  @Get('campus/templates')
  @ApiOperation({ summary: 'Listar templates de campus disponibles' })
  getTemplates() {
    return this.service.getTemplates();
  }

  @Get('campus/snapshot')
  @ApiOperation({ summary: 'Snapshot completo del campus (config + salas + props) para el cliente OFFICE' })
  getSnapshot(@Request() req: any) {
    return this.service.getCampusSnapshot(req.user.tenant_id);
  }

  // ─── Map Props ────────────────────────────────────────────────────────────

  @Get('campus/props')
  @ApiOperation({ summary: 'Listar accesorios del campus' })
  @ApiQuery({ name: 'room_id', required: false })
  findAll(@Query('room_id') roomId: string, @Request() req: any) {
    return this.service.findAll(req.user.tenant_id, roomId);
  }

  @Post('campus/props')
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Crear accesorio interactivo en el campus' })
  create(@Body() dto: CreateMapPropDto, @Request() req: any) {
    return this.service.create(req.user.tenant_id, dto);
  }

  @Patch('campus/props/:propId')
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Actualizar accesorio (posición, acción, ícono)' })
  update(@Param('propId') propId: string, @Body() dto: UpdateMapPropDto, @Request() req: any) {
    return this.service.update(req.user.tenant_id, propId, dto);
  }

  @Delete('campus/props/:propId')
  @Roles('admin', 'owner')
  @ApiOperation({ summary: 'Eliminar accesorio del campus' })
  remove(@Param('propId') propId: string, @Request() req: any) {
    return this.service.remove(req.user.tenant_id, propId);
  }
}
