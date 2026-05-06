import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import {
  CreateContactDto, UpdateContactDto, AddActivityDto, CreateDealDto,
} from './dto/contact.dto';
import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CreatePipelineDto {
  @ApiProperty() @IsString() @IsNotEmpty() name: string;
  @ApiPropertyOptional() @IsIn(['sales', 'support', 'hr', 'custom']) @IsOptional() pipeline_type?: string;
  @ApiPropertyOptional() @IsString() @IsOptional() department_id?: string;
}

class UpdateDealStageDto {
  @ApiProperty() @IsString() @IsNotEmpty() stage_id: string;
  @ApiPropertyOptional() @IsIn(['open', 'won', 'lost']) @IsOptional() status?: string;
}

@ApiTags('Contacts & CRM')
@ApiBearerAuth()
@Controller()
export class ContactsController {
  constructor(private service: ContactsService) {}

  // ─── Contacts ─────────────────────────────────────────────────────────────────

  @Post('contacts')
  @ApiOperation({ summary: 'Crear contacto' })
  create(@Body() dto: CreateContactDto, @Request() req: any) {
    return this.service.create(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Listar contactos' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'owner_slot_id', required: false })
  findAll(
    @Query('status') status: string,
    @Query('search') search: string,
    @Query('owner_slot_id') owner_slot_id: string,
    @Request() req: any,
  ) {
    return this.service.findAll(req.user.tenant_id, { status, search, owner_slot_id });
  }

  @Get('contacts/:contactId')
  @ApiOperation({ summary: 'Ver contacto con actividades y deals' })
  findOne(@Param('contactId') contactId: string, @Request() req: any) {
    return this.service.findOne(req.user.tenant_id, contactId);
  }

  @Patch('contacts/:contactId')
  @ApiOperation({ summary: 'Actualizar contacto' })
  update(@Param('contactId') contactId: string, @Body() dto: UpdateContactDto, @Request() req: any) {
    return this.service.update(req.user.tenant_id, contactId, dto);
  }

  @Delete('contacts/:contactId')
  @ApiOperation({ summary: 'Eliminar contacto' })
  delete(@Param('contactId') contactId: string, @Request() req: any) {
    return this.service.delete(req.user.tenant_id, contactId);
  }

  // ─── Activities ───────────────────────────────────────────────────────────────

  @Post('contacts/:contactId/activities')
  @ApiOperation({ summary: 'Registrar actividad en un contacto' })
  addActivity(
    @Param('contactId') contactId: string,
    @Body() dto: AddActivityDto,
    @Request() req: any,
  ) {
    return this.service.addActivity(req.user.tenant_id, req.user.slot_id, contactId, dto);
  }

  // ─── Deals ────────────────────────────────────────────────────────────────────

  @Post('contacts/:contactId/deals')
  @ApiOperation({ summary: 'Crear deal para un contacto' })
  createDeal(
    @Param('contactId') contactId: string,
    @Body() dto: CreateDealDto,
    @Request() req: any,
  ) {
    return this.service.createDeal(req.user.tenant_id, req.user.slot_id, contactId, dto);
  }

  @Patch('deals/:dealId/stage')
  @ApiOperation({ summary: 'Mover deal a otra etapa del pipeline' })
  moveDeal(
    @Param('dealId') dealId: string,
    @Body() dto: UpdateDealStageDto,
    @Request() req: any,
  ) {
    return this.service.updateDealStage(req.user.tenant_id, dealId, dto.stage_id, dto.status);
  }

  // ─── Pipelines ────────────────────────────────────────────────────────────────

  @Post('pipelines')
  @ApiOperation({ summary: 'Crear pipeline (ventas, soporte, etc.)' })
  createPipeline(@Body() dto: CreatePipelineDto, @Request() req: any) {
    return this.service.createPipeline(req.user.tenant_id, dto);
  }

  @Get('pipelines')
  @ApiOperation({ summary: 'Listar pipelines activos' })
  listPipelines(@Request() req: any) {
    return this.service.listPipelines(req.user.tenant_id);
  }

  @Get('pipelines/:pipelineId/board')
  @ApiOperation({ summary: 'Tablero Kanban del pipeline con deals por etapa' })
  getBoard(@Param('pipelineId') pipelineId: string, @Request() req: any) {
    return this.service.getPipelineBoard(req.user.tenant_id, pipelineId);
  }
}
