import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ErpAreasService } from './erp-areas.service';
import {
  CreateErpRequirementDto, UpdateErpRequirementDto,
  CreateErpServiceDto, UpdateErpServiceDto,
  CreateErpFeedbackDto,
} from './dto/erp.dto';

@ApiTags('erp-areas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('erp-areas')
export class ErpAreasController {
  constructor(private readonly erp: ErpAreasService) {}

  // ── Requerimientos ────────────────────────────────────────────────────────

  @Get('requirements')
  listRequirements(@Req() req: any, @Query('department_id') deptId?: string) {
    return this.erp.listRequirements(req.user.tenant_id, deptId);
  }

  @Get('requirements/:id')
  getRequirement(@Req() req: any, @Param('id') id: string) {
    return this.erp.getRequirement(req.user.tenant_id, id);
  }

  @Post('requirements')
  createRequirement(@Req() req: any, @Body() dto: CreateErpRequirementDto) {
    return this.erp.createRequirement(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Patch('requirements/:id')
  updateRequirement(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateErpRequirementDto) {
    return this.erp.updateRequirement(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Post('requirements/:id/deploy')
  deployToProduction(@Req() req: any, @Param('id') id: string) {
    return this.erp.deployToProduction(req.user.tenant_id, id);
  }

  // ── Servicios del requerimiento ───────────────────────────────────────────

  @Get('requirements/:requirementId/services')
  listServices(@Req() req: any, @Param('requirementId') rId: string) {
    return this.erp.listServices(req.user.tenant_id, rId);
  }

  @Post('requirements/:requirementId/services')
  createService(
    @Req() req: any,
    @Param('requirementId') rId: string,
    @Body() dto: CreateErpServiceDto,
  ) {
    return this.erp.createService(req.user.tenant_id, rId, dto);
  }

  @Patch('requirements/:requirementId/services/:serviceId')
  updateService(
    @Req() req: any,
    @Param('requirementId') rId: string,
    @Param('serviceId') sId: string,
    @Body() dto: UpdateErpServiceDto,
  ) {
    return this.erp.updateService(req.user.tenant_id, rId, sId, dto);
  }

  @Delete('requirements/:requirementId/services/:serviceId')
  deleteService(
    @Req() req: any,
    @Param('requirementId') rId: string,
    @Param('serviceId') sId: string,
  ) {
    return this.erp.deleteService(req.user.tenant_id, rId, sId);
  }

  // ── Retroalimentación ─────────────────────────────────────────────────────

  @Get('requirements/:requirementId/feedbacks')
  listFeedbacks(@Req() req: any, @Param('requirementId') rId: string) {
    return this.erp.listFeedbacks(req.user.tenant_id, rId);
  }

  @Post('requirements/:requirementId/feedbacks')
  addFeedback(
    @Req() req: any,
    @Param('requirementId') rId: string,
    @Body() dto: CreateErpFeedbackDto,
  ) {
    return this.erp.addFeedback(req.user.tenant_id, rId, req.user.slot_id, dto);
  }
}
