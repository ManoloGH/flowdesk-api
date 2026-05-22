import {
  Controller, Get, Post, Put, Delete, Param, Body, Request,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CultureService } from './culture.service';
import {
  UpsertCultureConfigDto, CreatePrincipleDto, UpdatePrincipleDto,
  CreateRitualDto, UpdateRitualDto,
} from './dto/culture.dto';

@ApiTags('Culture')
@ApiBearerAuth()
@Controller('culture')
export class CultureController {
  constructor(private readonly culture: CultureService) {}

  // ── Culture OS completo ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Obtener Culture OS completo de la empresa' })
  getFullCultureOS(@Request() req: any) {
    return this.culture.getFullCultureOS(req.tenant_id);
  }

  @Get('config')
  getConfig(@Request() req: any) {
    return this.culture.getConfig(req.tenant_id);
  }

  @Put('config')
  upsertConfig(@Request() req: any, @Body() dto: UpsertCultureConfigDto) {
    return this.culture.upsertConfig(req.tenant_id, dto);
  }

  // ── Principios ─────────────────────────────────────────────────────────────

  @Post('principles')
  createPrinciple(@Request() req: any, @Body() dto: CreatePrincipleDto) {
    return this.culture.createPrinciple(req.tenant_id, dto);
  }

  @Put('principles/:id')
  updatePrinciple(@Param('id') id: string, @Request() req: any, @Body() dto: UpdatePrincipleDto) {
    return this.culture.updatePrinciple(id, req.tenant_id, dto);
  }

  @Delete('principles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePrinciple(@Param('id') id: string, @Request() req: any) {
    return this.culture.deletePrinciple(id, req.tenant_id);
  }

  // ── Rituales ───────────────────────────────────────────────────────────────

  @Post('rituals')
  createRitual(@Request() req: any, @Body() dto: CreateRitualDto) {
    return this.culture.createRitual(req.tenant_id, dto);
  }

  @Put('rituals/:id')
  updateRitual(@Param('id') id: string, @Request() req: any, @Body() dto: UpdateRitualDto) {
    return this.culture.updateRitual(id, req.tenant_id, dto);
  }

  @Delete('rituals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRitual(@Param('id') id: string, @Request() req: any) {
    return this.culture.deleteRitual(id, req.tenant_id);
  }
}
