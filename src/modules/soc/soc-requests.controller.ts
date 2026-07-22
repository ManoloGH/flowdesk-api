import {
  Controller, Get, Post, Patch,
  Body, Param, Query, Request,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { SocRequestsService } from './soc-requests.service';
import {
  CreateSocRequestDto,
  UpdateSocRequestStatusDto,
  AddSocCommentDto,
  DecideSocApprovalDto,
  AssignRequestDto,
} from './dto/soc.dto';

@ApiTags('SOC — Solicitudes')
@ApiBearerAuth()
@Controller('soc/requests')
export class SocRequestsController {
  constructor(private service: SocRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una solicitud de servicio' })
  createRequest(@Body() dto: CreateSocRequestDto, @Request() req: any) {
    return this.service.createRequest(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar solicitudes — mine (mis solicitudes) | inbox (bandeja del departamento) | all' })
  @ApiQuery({ name: 'view', required: false, enum: ['mine', 'inbox', 'all'] })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'department_id', required: false })
  @ApiQuery({ name: 'service_id', required: false })
  listRequests(
    @Query('view') view: string,
    @Query('status') status: string,
    @Query('department_id') department_id: string,
    @Query('service_id') service_id: string,
    @Request() req: any,
  ) {
    return this.service.listRequests(req.user.tenant_id, req.user.slot_id, {
      view, status, department_id, service_id,
    });
  }

  @Get('analytics')
  @ApiOperation({ summary: 'KPIs del SOC OS (por tenant o por departamento)' })
  @ApiQuery({ name: 'department_id', required: false })
  getAnalytics(@Query('department_id') department_id: string, @Request() req: any) {
    return this.service.getAnalytics(req.user.tenant_id, department_id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle completo de una solicitud' })
  getRequest(@Param('id') id: string, @Request() req: any) {
    return this.service.getRequest(req.user.tenant_id, id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Transición de estado de la solicitud' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSocRequestStatusDto,
    @Request() req: any,
  ) {
    return this.service.updateStatus(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Agregar comentario a la solicitud' })
  addComment(
    @Param('id') id: string,
    @Body() dto: AddSocCommentDto,
    @Request() req: any,
  ) {
    return this.service.addComment(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Patch(':id/approvals/:approvalId')
  @ApiOperation({ summary: 'Aprobar o rechazar una solicitud (aprobador)' })
  decideApproval(
    @Param('id') id: string,
    @Param('approvalId') approvalId: string,
    @Body() dto: DecideSocApprovalDto,
    @Request() req: any,
  ) {
    return this.service.decideApproval(req.user.tenant_id, req.user.slot_id, id, approvalId, dto);
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: 'Asignar solicitud a un miembro del equipo' })
  assignRequest(
    @Param('id') id: string,
    @Body() dto: AssignRequestDto,
    @Request() req: any,
  ) {
    return this.service.assignRequest(req.user.tenant_id, req.user.slot_id, id, dto);
  }

  @Post(':id/documents')
  @ApiOperation({ summary: 'Adjuntar un archivo a la solicitud (Supabase Storage)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    return this.service.uploadDocument(req.user.tenant_id, req.user.slot_id, id, file);
  }
}
