import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
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

@ApiTags('Onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private onboarding: OnboardingService) {}

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
}
