import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { OnboardingService } from './onboarding.service';
import { OnboardingAgentService } from './onboarding-agent.service';
import { DocumentParserService } from './document-parser.service';
import {
  OnboardingStartDto,
  OnboardingDepartmentsDto,
  OnboardingTeamSlotsDto,
  OnboardingScheduleDto,
  OnboardingRoomsDto,
} from './dto/onboarding.dto';
import { Public } from '../auth/decorators/public.decorator';
import { TenantId } from '../../common/decorators/tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

class OnboardingChatDto {
  @ApiProperty({ required: false, description: 'ID de sesión para continuar una conversación existente' })
  @IsOptional()
  @IsString()
  session_id?: string;

  @ApiProperty({ description: 'Mensaje del usuario' })
  @IsString()
  message: string;
}

@ApiTags('Onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private onboarding: OnboardingService,
    private onboardingAgent: OnboardingAgentService,
    private documentParser: DocumentParserService,
  ) {}

  @Get('templates')
  @Public()
  @ApiOperation({ summary: 'Ver templates disponibles por industria (no requiere auth)' })
  getTemplates() {
    return this.onboarding.getTemplates();
  }

  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ver progreso del onboarding de mi empresa' })
  getStatus(@TenantId() tenantId: string) {
    return this.onboarding.getStatus(tenantId);
  }

  // El agente implementador llama estos endpoints en orden
  @Post('start')
  @Roles('superadmin')
  @ApiBearerAuth()
  @ApiOperation({ summary: '[Super-admin / Agente] PASO 1 — Crear empresa con template' })
  start(@Body() dto: OnboardingStartDto) {
    return this.onboarding.start(dto);
  }

  @Post('departments')
  @Roles('owner', 'admin', 'superadmin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner / Agente] PASO 2 — Configurar departamentos' })
  departments(@TenantId() tenantId: string, @Body() dto: OnboardingDepartmentsDto) {
    return this.onboarding.setupDepartments(tenantId, dto);
  }

  @Post('team')
  @Roles('owner', 'admin', 'superadmin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner / Agente] PASO 3 — Añadir equipo (humanos + agentes IA)' })
  team(@TenantId() tenantId: string, @Body() dto: OnboardingTeamSlotsDto) {
    return this.onboarding.setupTeam(tenantId, dto);
  }

  @Post('schedule')
  @Roles('owner', 'admin', 'superadmin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner / Agente] PASO 4 — Configurar horario laboral' })
  schedule(@TenantId() tenantId: string, @Body() dto: OnboardingScheduleDto) {
    return this.onboarding.setupSchedule(tenantId, dto);
  }

  @Post('rooms')
  @Roles('owner', 'admin', 'superadmin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner / Agente] PASO 5 — Configurar mapa de oficina' })
  rooms(@TenantId() tenantId: string, @Body() dto: OnboardingRoomsDto) {
    return this.onboarding.setupRooms(tenantId, dto);
  }

  @Post('launch')
  @Roles('owner', 'admin', 'superadmin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner / Agente] PASO 6 — Activar empresa (¡lanzar FlowDesk!)' })
  launch(@TenantId() tenantId: string) {
    return this.onboarding.launch(tenantId);
  }

  @Post('upload-doc')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: '[Público] Parsear documento para pre-rellenar onboarding' })
  async uploadDoc(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('text') text: string | undefined,
    @Body('hint') hint: string | undefined,
  ) {
    if (file) {
      return this.documentParser.parseFileBuffer(file.buffer, file.mimetype, hint);
    }
    if (text) {
      return this.documentParser.parseText(text, hint);
    }
    throw new BadRequestException('Se requiere un archivo o texto');
  }

  @Get('chat')
  @Public()
  @ApiOperation({ summary: '[Público] Marco saluda y crea la sesión de onboarding' })
  chatGreet() {
    return this.onboardingAgent.greet();
  }

  @Post('chat')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Público] Marco guía el onboarding completo en modo conversacional' })
  chat(@Body() dto: OnboardingChatDto) {
    return this.onboardingAgent.chat(dto.session_id, dto.message);
  }
}
