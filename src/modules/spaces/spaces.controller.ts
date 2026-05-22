import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SpacesService } from './spaces.service';
import { CreateSpaceDto, UpdateSpaceDto, CreateCameraDto, UpdateCameraDto } from './dto/space.dto';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Spaces & Cameras')
@ApiBearerAuth()
@Controller()
export class SpacesController {
  constructor(private service: SpacesService) {}

  // ─── Spaces ───────────────────────────────────────────────────────────────────

  @Get('spaces')
  @ApiOperation({ summary: 'Listar espacios con cámaras del tenant' })
  list(@Request() req: any) {
    return this.service.listSpaces(req.user.tenant_id);
  }

  @Post('spaces')
  @Roles('admin', 'owner', 'superadmin')
  @ApiOperation({ summary: 'Crear espacio físico' })
  create(@Body() dto: CreateSpaceDto, @Request() req: any) {
    return this.service.createSpace(req.user.tenant_id, dto);
  }

  @Patch('spaces/:spaceId')
  @Roles('admin', 'owner', 'superadmin')
  @ApiOperation({ summary: 'Actualizar espacio' })
  update(@Param('spaceId') spaceId: string, @Body() dto: UpdateSpaceDto, @Request() req: any) {
    return this.service.updateSpace(req.user.tenant_id, spaceId, dto);
  }

  @Delete('spaces/:spaceId')
  @Roles('admin', 'owner', 'superadmin')
  @ApiOperation({ summary: 'Eliminar espacio y sus cámaras' })
  remove(@Param('spaceId') spaceId: string, @Request() req: any) {
    return this.service.deleteSpace(req.user.tenant_id, spaceId);
  }

  // ─── Cameras ──────────────────────────────────────────────────────────────────

  @Post('spaces/:spaceId/cameras')
  @Roles('admin', 'owner', 'superadmin')
  @ApiOperation({ summary: 'Agregar cámara a un espacio' })
  addCamera(
    @Param('spaceId') spaceId: string,
    @Body() dto: CreateCameraDto,
    @Request() req: any,
  ) {
    return this.service.addCamera(req.user.tenant_id, spaceId, dto);
  }

  @Patch('spaces/:spaceId/cameras/:cameraId')
  @Roles('admin', 'owner', 'superadmin')
  @ApiOperation({ summary: 'Actualizar datos o URL de una cámara' })
  updateCamera(
    @Param('spaceId') spaceId: string,
    @Param('cameraId') cameraId: string,
    @Body() dto: UpdateCameraDto,
    @Request() req: any,
  ) {
    return this.service.updateCamera(req.user.tenant_id, spaceId, cameraId, dto);
  }

  @Delete('spaces/:spaceId/cameras/:cameraId')
  @Roles('admin', 'owner', 'superadmin')
  @ApiOperation({ summary: 'Eliminar cámara' })
  removeCamera(
    @Param('spaceId') spaceId: string,
    @Param('cameraId') cameraId: string,
    @Request() req: any,
  ) {
    return this.service.deleteCamera(req.user.tenant_id, spaceId, cameraId);
  }

  @Get('spaces/:spaceId/cameras/:cameraId/stream-url')
  @ApiOperation({ summary: 'Obtener URL descifrada del stream (para mostrar en el visor)' })
  streamUrl(
    @Param('spaceId') spaceId: string,
    @Param('cameraId') cameraId: string,
    @Request() req: any,
  ) {
    return this.service.getStreamUrl(req.user.tenant_id, spaceId, cameraId);
  }
}
