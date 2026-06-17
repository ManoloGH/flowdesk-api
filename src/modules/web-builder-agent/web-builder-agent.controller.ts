import {
  Controller, Post, Get, Param, Body, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WebBuilderAgentService } from './web-builder-agent.service';
import { StartBuildDto, DeployDto } from './dto/start-build.dto';

@ApiTags('Web Builder Agent')
@ApiBearerAuth()
@Controller()
export class WebBuilderAgentController {
  constructor(private service: WebBuilderAgentService) {}

  @Post('web-builder-agent/:proyectoId/build')
  @ApiOperation({ summary: 'Iniciar construcción del sitio web con IA' })
  startBuild(
    @Param('proyectoId') proyectoId: string,
    @Body() dto: StartBuildDto,
    @Request() req: any,
  ) {
    return this.service.startBuild(req.user.tenant_id, req.user.slot_id, proyectoId, dto);
  }

  @Get('web-builder-agent/:proyectoId/files')
  @ApiOperation({ summary: 'Obtener archivos HTML generados' })
  getFiles(@Param('proyectoId') proyectoId: string, @Request() req: any) {
    return this.service.getFiles(req.user.tenant_id, proyectoId);
  }

  @Post('web-builder-agent/:proyectoId/deploy')
  @ApiOperation({ summary: 'Desplegar en Vercel' })
  deploy(
    @Param('proyectoId') proyectoId: string,
    @Body() dto: DeployDto,
    @Request() req: any,
  ) {
    return this.service.deployToVercel(req.user.tenant_id, req.user.slot_id, proyectoId, dto);
  }
}
