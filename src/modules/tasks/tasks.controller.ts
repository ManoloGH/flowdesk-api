import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto, CreateGoalDto, UpdateGoalDto } from './dto/task.dto';

@ApiTags('Tasks & Goals')
@ApiBearerAuth()
@Controller()
export class TasksController {
  constructor(private service: TasksService) {}

  // ─── Tasks ────────────────────────────────────────────────────────────────────

  @Post('tasks')
  @ApiOperation({ summary: 'Crear una tarea' })
  createTask(@Body() dto: CreateTaskDto, @Request() req: any) {
    return this.service.createTask(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Listar mis tareas (propietario + asignado)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  listTasks(
    @Query('status') status: string,
    @Query('priority') priority: string,
    @Request() req: any,
  ) {
    return this.service.listTasks(req.user.tenant_id, req.user.slot_id, { status, priority });
  }

  @Get('tasks/summary')
  @ApiOperation({ summary: 'Resumen de productividad del escritorio personal' })
  summary(@Request() req: any) {
    return this.service.desktopSummary(req.user.tenant_id, req.user.slot_id);
  }

  @Get('tasks/activity')
  @ApiOperation({ summary: 'Feed de actividad reciente del usuario' })
  activity(@Request() req: any) {
    return this.service.activityFeed(req.user.tenant_id, req.user.slot_id);
  }

  @Get('tasks/missions')
  @ApiOperation({ summary: 'Misiones del usuario (goals activos + sintéticas)' })
  missions(@Request() req: any) {
    return this.service.missions(req.user.tenant_id, req.user.slot_id);
  }

  @Get('departments/:departmentId/tasks')
  @ApiOperation({ summary: 'Tareas de un departamento' })
  deptTasks(@Param('departmentId') departmentId: string, @Request() req: any) {
    return this.service.listDepartmentTasks(req.user.tenant_id, departmentId);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({ summary: 'Actualizar tarea (estado, prioridad, etc.)' })
  updateTask(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
    @Request() req: any,
  ) {
    return this.service.updateTask(req.user.tenant_id, req.user.slot_id, taskId, dto);
  }

  @Delete('tasks/:taskId')
  @ApiOperation({ summary: 'Eliminar una tarea' })
  deleteTask(@Param('taskId') taskId: string, @Request() req: any) {
    return this.service.deleteTask(req.user.tenant_id, req.user.slot_id, taskId);
  }

  // ─── Goals ────────────────────────────────────────────────────────────────────

  @Post('goals')
  @ApiOperation({ summary: 'Crear objetivo / KPI personal' })
  createGoal(@Body() dto: CreateGoalDto, @Request() req: any) {
    return this.service.createGoal(req.user.tenant_id, req.user.slot_id, dto);
  }

  @Get('goals')
  @ApiOperation({ summary: 'Listar mis objetivos' })
  listGoals(@Request() req: any) {
    return this.service.listGoals(req.user.tenant_id, req.user.slot_id);
  }

  @Patch('goals/:goalId')
  @ApiOperation({ summary: 'Actualizar objetivo (progreso, estado)' })
  updateGoal(
    @Param('goalId') goalId: string,
    @Body() dto: UpdateGoalDto,
    @Request() req: any,
  ) {
    return this.service.updateGoal(req.user.tenant_id, req.user.slot_id, goalId, dto);
  }

  @Delete('goals/:goalId')
  @ApiOperation({ summary: 'Eliminar objetivo' })
  deleteGoal(@Param('goalId') goalId: string, @Request() req: any) {
    return this.service.deleteGoal(req.user.tenant_id, req.user.slot_id, goalId);
  }
}
