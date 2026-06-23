import {
  Controller, Post, Get, Patch, Param, Body, Request, Res, Header,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { WidgetService } from './widget.service';
import { CreateWidgetConfigDto, ChatDto, SaveLeadDto } from './dto/widget.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Widget')
@Controller()
export class WidgetController {
  constructor(private service: WidgetService) {}

  // ── Públicos (sin JWT) ──────────────────────────────────────────────────────

  @Public()
  @Get('public/widget/:proyectoId/config')
  @ApiOperation({ summary: 'Config pública del widget (para inicializar el embed)' })
  getPublicConfig(@Param('proyectoId') proyectoId: string) {
    return this.service.getPublicConfig(proyectoId);
  }

  @Public()
  @Post('public/widget/:proyectoId/chat')
  @ApiOperation({ summary: 'Enviar mensaje al agente del widget' })
  chat(@Param('proyectoId') proyectoId: string, @Body() dto: ChatDto) {
    return this.service.chat(proyectoId, dto);
  }

  @Public()
  @Post('public/widget/:proyectoId/lead')
  @ApiOperation({ summary: 'Guardar lead capturado por el widget' })
  saveLead(@Param('proyectoId') proyectoId: string, @Body() dto: SaveLeadDto) {
    return this.service.saveLead(proyectoId, dto);
  }

  @Public()
  @Get('public/widget/:proyectoId/script.js')
  @ApiOperation({ summary: 'Devuelve el JS del widget listo para incrustar' })
  async getScript(
    @Param('proyectoId') proyectoId: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const apiUrl = process.env.API_PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
    const script = await this.service.getScript(proyectoId, apiUrl);
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(script);
  }

  // ── Protegidos (con JWT) ────────────────────────────────────────────────────

  @ApiBearerAuth()
  @Post('widget/:proyectoId/config')
  @ApiOperation({ summary: 'Guardar configuración del widget' })
  saveConfig(
    @Param('proyectoId') proyectoId: string,
    @Body() dto: CreateWidgetConfigDto,
    @Request() req: any,
  ) {
    return this.service.saveConfig(req.user.tenant_id, proyectoId, dto);
  }

  @ApiBearerAuth()
  @Get('widget/:proyectoId/config')
  @ApiOperation({ summary: 'Obtener configuración del widget' })
  getConfig(@Param('proyectoId') proyectoId: string, @Request() req: any) {
    return this.service.getConfig(req.user.tenant_id, proyectoId);
  }

  @ApiBearerAuth()
  @Patch('widget/:proyectoId/toggle')
  @ApiOperation({ summary: 'Activar / desactivar el widget' })
  toggleActive(@Param('proyectoId') proyectoId: string, @Request() req: any) {
    return this.service.toggleActive(req.user.tenant_id, proyectoId);
  }

  @ApiBearerAuth()
  @Get('widget/:proyectoId/leads')
  @ApiOperation({ summary: 'Listar leads capturados por el widget' })
  getLeads(@Param('proyectoId') proyectoId: string, @Request() req: any) {
    return this.service.getLeads(req.user.tenant_id, proyectoId);
  }

  @ApiBearerAuth()
  @Get('widget/:proyectoId/embed-tag')
  @ApiOperation({ summary: 'Obtener tag <script> listo para copiar' })
  getEmbedTag(@Param('proyectoId') proyectoId: string, @Request() req: any) {
    const apiUrl = process.env.API_PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
    return { tag: this.service.getEmbedTag(proyectoId, apiUrl) };
  }
}
