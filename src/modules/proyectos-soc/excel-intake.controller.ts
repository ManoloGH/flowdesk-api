import { Controller, Get, Post, Body, Param, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ExcelIntakeService } from './excel-intake.service';
import { CreateIntakeTokenDto, AnswerQuestionnaireDto } from './dto/excel-intake.dto';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Proyectos SOC — Excel Intake')
@Controller('proyectos-soc/intake')
export class ExcelIntakeController {
  constructor(private service: ExcelIntakeService) {}

  // ── PM: endpoints protegidos ───────────────────────────────────────

  @ApiBearerAuth()
  @Post('tokens')
  @ApiOperation({ summary: 'Generar link de intake para un área' })
  createToken(@Request() req: any, @Body() dto: CreateIntakeTokenDto) {
    return this.service.createToken(req.user.tenant_id, dto);
  }

  @ApiBearerAuth()
  @Get('uploads')
  @ApiOperation({ summary: 'Listar todos los uploads del tenant' })
  listUploads(@Request() req: any) {
    return this.service.listUploads(req.user.tenant_id);
  }

  @ApiBearerAuth()
  @Get('uploads/:id')
  @ApiOperation({ summary: 'Detalle de un upload' })
  getUpload(@Request() req: any, @Param('id') id: string) {
    return this.service.getUpload(req.user.tenant_id, id);
  }

  @ApiBearerAuth()
  @Post('uploads/:id/answer')
  @ApiOperation({ summary: 'Guardar respuestas del área al cuestionario' })
  answerQuestionnaire(@Request() req: any, @Param('id') id: string, @Body() dto: AnswerQuestionnaireDto) {
    return this.service.answerQuestionnaire(req.user.tenant_id, id, dto);
  }

  // ── Público: área sube Excel sin autenticación ─────────────────────

  @Public()
  @Get('area/:token')
  @ApiOperation({ summary: '[PÚBLICO] Validar token y obtener info del área' })
  getAreaUpload(@Param('token') token: string) {
    return this.service.getUploadByToken(token);
  }

  @Public()
  @Post('area/:token/submit')
  @ApiOperation({ summary: '[PÚBLICO] Área sube contenido del Excel' })
  submitExcel(
    @Param('token') token: string,
    @Body() body: { content: string; file_name?: string },
  ) {
    return this.service.submitExcelContent(token, body.content, body.file_name);
  }

  @Public()
  @Post('area/:token/answer')
  @ApiOperation({ summary: '[PÚBLICO] Área envía confirmación del paquete (preguntas + pantallas + supuestos)' })
  answerByToken(@Param('token') token: string, @Body() dto: AnswerQuestionnaireDto) {
    return this.service.answerByToken(token, dto);
  }
}
