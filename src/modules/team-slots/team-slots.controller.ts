import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TeamSlotsService } from './team-slots.service';
import { CreateHumanSlotDto, CreateAgentSlotDto } from './dto/create-slot.dto';
import { UpdateSlotDto, UpdateStatusDto } from './dto/update-slot.dto';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Team Slots (Equipo)')
@ApiBearerAuth()
@Controller('team-slots')
export class TeamSlotsController {
  constructor(private slotsService: TeamSlotsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todo el equipo de mi empresa' })
  @ApiQuery({ name: 'type', required: false, enum: ['HUMAN', 'AI_AGENT'] })
  @ApiQuery({ name: 'department_id', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['ONLINE', 'OFFLINE', 'BUSY', 'AWAY'] })
  findAll(
    @TenantId() tenantId: string,
    @Query('type') type?: string,
    @Query('department_id') department_id?: string,
    @Query('status') status?: string,
  ) {
    return this.slotsService.findAll(tenantId, { type, department_id, status });
  }

  @Get('office-map')
  @ApiOperation({ summary: 'Mapa de la oficina — posiciones de todos los miembros del equipo' })
  officeMap(@TenantId() tenantId: string) {
    return this.slotsService.officeMap(tenantId);
  }

  @Get('me')
  @ApiOperation({ summary: 'Ver mi propio perfil de slot' })
  me(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.slotsService.findOne(user.slot_id, tenantId);
  }

  @Get('me/agent')
  @ApiOperation({ summary: 'Obtener mi agente IA personal (o el primero del tenant)' })
  myAgent(@CurrentUser() user: any, @TenantId() tenantId: string) {
    return this.slotsService.myAgent(user.slot_id, tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un miembro del equipo por ID' })
  findOne(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.slotsService.findOne(id, tenantId);
  }

  @Post('human')
  @Roles('owner', 'admin', 'manager')
  @ApiOperation({ summary: '[Manager+] Añadir humano al equipo — genera contraseña temporal' })
  createHuman(@TenantId() tenantId: string, @Body() dto: CreateHumanSlotDto) {
    return this.slotsService.createHuman(tenantId, dto);
  }

  @Post('agent')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: '[Owner/Admin] Añadir agente IA al equipo' })
  createAgent(@TenantId() tenantId: string, @Body() dto: CreateAgentSlotDto) {
    return this.slotsService.createAgent(tenantId, dto);
  }

  @Patch('me/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar mi propio status (ONLINE, BUSY, AWAY, OFFLINE)' })
  updateMyStatus(@CurrentUser() user: any, @TenantId() tenantId: string, @Body() dto: UpdateStatusDto) {
    return this.slotsService.updateStatus(user.slot_id, tenantId, dto);
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Actualizar mi perfil (avatar, posición en oficina)' })
  updateMe(@CurrentUser() user: any, @TenantId() tenantId: string, @Body() dto: UpdateSlotDto) {
    return this.slotsService.update(user.slot_id, tenantId, dto, user.role, user.slot_id);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'manager')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Manager+] Actualizar datos de un miembro del equipo' })
  update(
    @Param('id') id: string,
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateSlotDto,
  ) {
    return this.slotsService.update(id, tenantId, dto, user.role, user.slot_id);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Owner/Admin] Eliminar miembro del equipo' })
  remove(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.slotsService.remove(id, tenantId);
  }
}
