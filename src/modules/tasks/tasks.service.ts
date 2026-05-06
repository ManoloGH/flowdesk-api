import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateTaskDto, UpdateTaskDto, CreateGoalDto, UpdateGoalDto } from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  // ─── TASKS ───────────────────────────────────────────────────────────────────

  async createTask(tenantId: string, ownerSlotId: string, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        tenant_id: tenantId,
        owner_id: ownerSlotId,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'medium',
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        assignee_id: dto.assignee_id,
        department_id: dto.department_id,
        tags: dto.tags ?? [],
      },
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true } },
        department: { select: { id: true, name: true } },
      },
    });
  }

  async listTasks(tenantId: string, slotId: string, filter?: { status?: string; priority?: string; assignee?: boolean }) {
    const where: any = {
      tenant_id: tenantId,
      OR: [{ owner_id: slotId }, { assignee_id: slotId }],
    };

    if (filter?.status) where.status = filter.status;
    if (filter?.priority) where.priority = filter.priority;

    return this.prisma.task.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, avatar_url: true } },
        assignee: { select: { id: true, name: true, avatar_url: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: [
        { status: 'asc' },
        { priority: 'asc' },
        { due_date: 'asc' },
      ],
    });
  }

  async listDepartmentTasks(tenantId: string, departmentId: string) {
    return this.prisma.task.findMany({
      where: { tenant_id: tenantId, department_id: departmentId },
      include: {
        owner: { select: { id: true, name: true, avatar_url: true } },
        assignee: { select: { id: true, name: true, avatar_url: true } },
      },
      orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
    });
  }

  async updateTask(tenantId: string, slotId: string, taskId: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenant_id: tenantId },
    });
    if (!task) throw new NotFoundException('Tarea no encontrada');
    if (task.owner_id !== slotId && task.assignee_id !== slotId) {
      throw new ForbiddenException('Solo el propietario o asignado puede modificar esta tarea');
    }

    const data: any = { ...dto };
    if (dto.due_date) data.due_date = new Date(dto.due_date);
    if (dto.status === 'completed') data.completed_at = new Date();

    return this.prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        assignee: { select: { id: true, name: true, avatar_url: true } },
      },
    });
  }

  async deleteTask(tenantId: string, slotId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, tenant_id: tenantId, owner_id: slotId },
    });
    if (!task) throw new NotFoundException('Tarea no encontrada o no tienes permiso');
    await this.prisma.task.delete({ where: { id: taskId } });
    return { deleted: true };
  }

  // ─── GOALS ───────────────────────────────────────────────────────────────────

  async createGoal(tenantId: string, slotId: string, dto: CreateGoalDto) {
    return this.prisma.goal.create({
      data: {
        tenant_id: tenantId,
        slot_id: slotId,
        title: dto.title,
        description: dto.description,
        goal_type: dto.goal_type ?? 'personal',
        target_value: dto.target_value,
        unit: dto.unit,
        period: dto.period ?? 'monthly',
        start_date: dto.start_date ? new Date(dto.start_date) : undefined,
        end_date: dto.end_date ? new Date(dto.end_date) : undefined,
      },
    });
  }

  async listGoals(tenantId: string, slotId: string) {
    return this.prisma.goal.findMany({
      where: { tenant_id: tenantId, slot_id: slotId },
      orderBy: [{ status: 'asc' }, { end_date: 'asc' }],
    });
  }

  async updateGoal(tenantId: string, slotId: string, goalId: string, dto: UpdateGoalDto) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenant_id: tenantId, slot_id: slotId },
    });
    if (!goal) throw new NotFoundException('Objetivo no encontrado');

    const data: any = { ...dto };
    if (dto.start_date) data.start_date = new Date(dto.start_date);
    if (dto.end_date) data.end_date = new Date(dto.end_date);

    return this.prisma.goal.update({ where: { id: goalId }, data });
  }

  async deleteGoal(tenantId: string, slotId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenant_id: tenantId, slot_id: slotId },
    });
    if (!goal) throw new NotFoundException('Objetivo no encontrado');
    await this.prisma.goal.delete({ where: { id: goalId } });
    return { deleted: true };
  }

  // Feed de actividad reciente del usuario
  async activityFeed(tenantId: string, slotId: string) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const myTasks = { tenant_id: tenantId, OR: [{ owner_id: slotId }, { assignee_id: slotId }] };

    const [completed, created, conversations, goalsCreated] = await Promise.all([
      this.prisma.task.findMany({
        where: { ...myTasks, status: 'completed', completed_at: { gte: sevenDaysAgo } },
        select: { id: true, title: true, completed_at: true, priority: true },
        orderBy: { completed_at: 'desc' },
        take: 6,
      }),
      this.prisma.task.findMany({
        where: { ...myTasks, created_at: { gte: sevenDaysAgo } },
        select: { id: true, title: true, created_at: true, priority: true },
        orderBy: { created_at: 'desc' },
        take: 4,
      }),
      this.prisma.agentConversation.findMany({
        where: { tenant_id: tenantId, human_id: slotId, started_at: { gte: sevenDaysAgo } },
        select: { id: true, started_at: true, agent: { select: { name: true } }, _count: { select: { messages: true } } },
        orderBy: { started_at: 'desc' },
        take: 4,
      }),
      this.prisma.goal.findMany({
        where: { tenant_id: tenantId, slot_id: slotId, created_at: { gte: sevenDaysAgo } },
        select: { id: true, title: true, created_at: true },
        orderBy: { created_at: 'desc' },
        take: 3,
      }),
    ]);

    const events: Array<{ id: string; type: string; label: string; time: Date; icon: string; color: string }> = [];

    for (const t of completed) {
      events.push({ id: `tc-${t.id}`, type: 'task_completed', label: `Tarea completada: "${t.title}"`, time: t.completed_at!, icon: '✓', color: '#10b981' });
    }
    for (const t of created) {
      if (t.created_at && !completed.find(c => c.id === t.id)) {
        events.push({ id: `tk-${t.id}`, type: 'task_created', label: `Nueva tarea: "${t.title}"`, time: t.created_at, icon: '+', color: '#6366f1' });
      }
    }
    for (const c of conversations) {
      events.push({ id: `cv-${c.id}`, type: 'conversation', label: `Chat con ${c.agent?.name ?? 'Agente'} (${c._count.messages} mensajes)`, time: c.started_at, icon: '✦', color: '#8b5cf6' });
    }
    for (const g of goalsCreated) {
      events.push({ id: `gl-${g.id}`, type: 'goal_created', label: `Meta creada: "${g.title}"`, time: g.created_at!, icon: '◎', color: '#f59e0b' });
    }

    events.sort((a, b) => b.time.getTime() - a.time.getTime());
    return events.slice(0, 8).map(e => ({ ...e, time: e.time.toISOString() }));
  }

  // Misiones: goals activos + misiones sintéticas basadas en tasks
  async missions(tenantId: string, slotId: string) {
    const myTasks = { tenant_id: tenantId, OR: [{ owner_id: slotId }, { assignee_id: slotId }] };
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

    const [activeGoals, urgentTotal, urgentDone, pendingTotal, completedToday] = await Promise.all([
      this.prisma.goal.findMany({
        where: { tenant_id: tenantId, slot_id: slotId, status: 'active' },
        select: { id: true, title: true, current_value: true, target_value: true, unit: true, period: true },
        orderBy: { end_date: 'asc' },
        take: 4,
      }),
      this.prisma.task.count({ where: { ...myTasks, priority: { in: ['urgent', 'high'] } } }),
      this.prisma.task.count({ where: { ...myTasks, priority: { in: ['urgent', 'high'] }, status: 'completed', completed_at: { gte: todayStart } } }),
      this.prisma.task.count({ where: { ...myTasks, status: { in: ['pending', 'in_progress'] } } }),
      this.prisma.task.count({ where: { ...myTasks, status: 'completed', completed_at: { gte: todayStart } } }),
    ]);

    const missionsList: Array<{ id: string; label: string; current: number; total: number; points: number; source: string }> = [];

    // Goals reales primero
    for (const g of activeGoals) {
      if (g.target_value && g.target_value > 0) {
        missionsList.push({
          id: g.id,
          label: g.title,
          current: Math.min(g.current_value ?? 0, g.target_value),
          total: g.target_value,
          points: 50,
          source: 'goal',
        });
      }
    }

    // Misiones sintéticas basadas en tasks del día
    if (urgentTotal > 0) {
      missionsList.push({
        id: 'mission-urgent',
        label: 'Resolver tareas prioritarias hoy',
        current: urgentDone,
        total: Math.min(urgentTotal, 5),
        points: 30,
        source: 'tasks',
      });
    }

    if (pendingTotal > 0 || completedToday > 0) {
      const dailyTarget = Math.max(3, Math.min(pendingTotal + completedToday, 8));
      missionsList.push({
        id: 'mission-daily',
        label: 'Completar tareas del día',
        current: completedToday,
        total: dailyTarget,
        points: 20,
        source: 'tasks',
      });
    }

    return missionsList;
  }

  // Resumen de productividad del escritorio personal
  async desktopSummary(tenantId: string, slotId: string) {
    const myTasks = { tenant_id: tenantId, OR: [{ owner_id: slotId }, { assignee_id: slotId }] };
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const todayEnd   = new Date(new Date().setHours(23, 59, 59, 999));

    const [pending, in_progress, completed_today, overdue, active_goals, top_pending] = await Promise.all([
      this.prisma.task.count({ where: { ...myTasks, status: 'pending' } }),
      this.prisma.task.count({ where: { ...myTasks, status: 'in_progress' } }),
      this.prisma.task.count({ where: { ...myTasks, status: 'completed', completed_at: { gte: todayStart, lte: todayEnd } } }),
      this.prisma.task.count({ where: { ...myTasks, status: { in: ['pending', 'in_progress'] }, due_date: { lt: todayStart } } }),
      this.prisma.goal.count({ where: { tenant_id: tenantId, slot_id: slotId, status: 'active' } }),
      this.prisma.task.findMany({
        where: { ...myTasks, status: { in: ['pending', 'in_progress'] } },
        select: { id: true, title: true, priority: true },
        orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
        take: 5,
      }),
    ]);

    return { pending, in_progress, completed_today, overdue, active_goals, top_pending };
  }
}
