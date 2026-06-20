import {
  Controller, Post, Get, Param, Body, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WebBuilderAgentService } from './web-builder-agent.service';
import { StartBuildDto, DeployDto, StartFromBriefDto, StartFromInstagramDto, StartHeroVideoDto } from './dto/start-build.dto';

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

  @Post('web-builder-agent/:proyectoId/build-from-brief')
  @ApiOperation({ summary: 'Construir landing desde brief de marca (sin HTML existente)' })
  startFromBrief(
    @Param('proyectoId') proyectoId: string,
    @Body() dto: StartFromBriefDto,
    @Request() req: any,
  ) {
    return this.service.startFromBrief(req.user.tenant_id, req.user.slot_id, proyectoId, dto);
  }

  @Post('web-builder-agent/:proyectoId/build-from-instagram')
  @ApiOperation({ summary: 'Crear web de marca personal desde perfil de Instagram' })
  startFromInstagram(
    @Param('proyectoId') proyectoId: string,
    @Body() dto: StartFromInstagramDto,
    @Request() req: any,
  ) {
    return this.service.startFromInstagram(req.user.tenant_id, req.user.slot_id, proyectoId, dto);
  }

  @Post('web-builder-agent/:proyectoId/generate-hero-video')
  @ApiOperation({ summary: 'Generar video hero con IA (Higgsfield Kling 3.0 Turbo)' })
  generateHeroVideo(
    @Param('proyectoId') proyectoId: string,
    @Body() dto: StartHeroVideoDto,
    @Request() req: any,
  ) {
    return this.service.generateHeroVideo(req.user.tenant_id, proyectoId, dto);
  }

  @Get('web-builder-agent/:proyectoId/hero-video-status/:jobId')
  @ApiOperation({ summary: 'Consultar estado del video hero en generación' })
  getHeroVideoStatus(
    @Param('proyectoId') proyectoId: string,
    @Param('jobId') jobId: string,
    @Request() req: any,
  ) {
    return this.service.getHeroVideoStatus(req.user.tenant_id, proyectoId, jobId);
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
