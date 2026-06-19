import { Controller, Post, Get, Body, Request, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PersonalAssistantService } from './personal-assistant.service';
import { PersonalChatDto } from './dto/personal-assistant.dto';

@ApiTags('Personal Assistant')
@ApiBearerAuth()
@Controller('assistant')
export class PersonalAssistantController {
  constructor(private readonly service: PersonalAssistantService) {}

  @Post('chat')
  @ApiOperation({ summary: 'Enviar mensaje al asistente personal (empleado / gerente / director)' })
  chat(@Body() dto: PersonalChatDto, @Request() req: any) {
    return this.service.chat(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Historial de conversaciones con el asistente personal' })
  sessions(@Request() req: any) {
    return this.service.getSessions(req.user.tenant_id, req.user.slot_id);
  }

  @Get('skills')
  @ApiOperation({ summary: 'Matriz de habilidades del usuario o de su equipo (managers)' })
  skills(@Request() req: any) {
    return this.service.getSkillMatrix(req.user.tenant_id, req.user.slot_id);
  }
}
