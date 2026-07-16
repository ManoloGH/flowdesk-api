import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateSocRequestDto,
  UpdateSocRequestStatusDto,
  AddSocCommentDto,
  DecideSocApprovalDto,
} from './dto/soc.dto';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador', PENDING: 'Pendiente', APPROVED: 'Aprobado',
  IN_PROGRESS: 'En proceso', WAITING_INFO: 'Esperando info',
  IN_REVIEW: 'En revisión', ACCEPTED: 'Aceptado', CLOSED: 'Cerrado',
  REJECTED: 'Rechazado', CANCELLED: 'Cancelado',
};

// Transiciones de estado permitidas
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT:        ['PENDING', 'CANCELLED'],
  PENDING:      ['APPROVED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS'],
  APPROVED:     ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS:  ['WAITING_INFO', 'IN_REVIEW', 'CLOSED', 'CANCELLED'],
  WAITING_INFO: ['IN_PROGRESS', 'CANCELLED'],
  IN_REVIEW:    ['ACCEPTED', 'IN_PROGRESS'],
  ACCEPTED:     ['CLOSED'],
  CLOSED:       [],
  REJECTED:     [],
  CANCELLED:    [],
};

@Injectable()
export class SocRequestsService {
  constructor(private prisma: PrismaService) {}

  // ── Crear solicitud ───────────────────────────────────────────────────────

  async createRequest(tenantId: string, slotId: string, dto: CreateSocRequestDto) {
    const service = await this.prisma.socService.findFirst({
      where: { id: dto.service_id, tenant_id: tenantId, is_active: true },
    });
    if (!service) throw new NotFoundException('Servicio no encontrado o inactivo');

    const requestNumber = await this.generateRequestNumber(tenantId);

    const dueDate = service.sla_hours
      ? new Date(Date.now() + service.sla_hours * 3_600_000)
      : undefined;

    const initialStatus = service.requires_approval ? 'PENDING' : 'PENDING';

    const request = await this.prisma.socRequest.create({
      data: {
        request_number: requestNumber,
        tenant_id: tenantId,
        service_id: dto.service_id,
        requester_id: slotId,
        status: initialStatus as any,
        priority: (dto.priority ?? 'NORMAL') as any,
        title: dto.title,
        description: dto.description,
        form_data: dto.form_data ?? undefined,
        sla_hours: service.sla_hours,
        due_date: dueDate,
      },
      include: this.requestIncludes(),
    });

    // Crear pasos de aprobación si el servicio lo requiere
    if (service.requires_approval && Array.isArray(service.approval_flow)) {
      const steps = service.approval_flow as any[];
      await this.prisma.socApproval.createMany({
        data: steps.map((step: any) => ({
          request_id: request.id,
          approver_id: step.slot_id ?? slotId, // fallback al solicitante si no hay slot específico
          step: step.step,
          status: 'pending',
        })),
      });
    }

    await this.recordHistory(request.id, slotId, 'created', undefined, initialStatus);
    return request;
  }

  // ── Listar solicitudes ────────────────────────────────────────────────────

  async listRequests(
    tenantId: string,
    slotId: string,
    filters: {
      view?: string; // 'mine' | 'inbox' | 'all'
      status?: string;
      department_id?: string;
      service_id?: string;
    },
  ) {
    const { view = 'mine', status, department_id, service_id } = filters;
    const where: any = { tenant_id: tenantId };

    if (status) where.status = status;
    if (service_id) where.service_id = service_id;

    if (view === 'mine') {
      where.requester_id = slotId;
    } else if (view === 'inbox') {
      // Bandeja del departamento: solicitudes asignadas al slot o al departamento del slot
      const slot = await this.prisma.teamSlot.findFirst({
        where: { id: slotId, tenant_id: tenantId },
        select: { department_id: true },
      });
      const deptId = department_id ?? slot?.department_id;
      if (deptId) {
        where.service = { department_id: deptId };
      } else {
        where.assigned_to_id = slotId;
      }
    }

    return this.prisma.socRequest.findMany({
      where,
      include: this.requestIncludes(),
      orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
    });
  }

  // ── Detalle de solicitud ──────────────────────────────────────────────────

  async getRequest(tenantId: string, requestId: string) {
    const request = await this.prisma.socRequest.findFirst({
      where: { id: requestId, tenant_id: tenantId },
      include: {
        ...this.requestIncludes(),
        approvals: {
          include: { approver: { select: { id: true, name: true, avatar_url: true, role: true } } },
          orderBy: { step: 'asc' },
        },
        comments: {
          include: { slot: { select: { id: true, name: true, avatar_url: true, type: true } } },
          orderBy: { created_at: 'asc' },
        },
        documents: {
          include: { slot: { select: { id: true, name: true } } },
          orderBy: { created_at: 'desc' },
        },
        history: {
          include: { slot: { select: { id: true, name: true, avatar_url: true } } },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    return request;
  }

  // ── Transición de estado ──────────────────────────────────────────────────

  async updateStatus(
    tenantId: string,
    slotId: string,
    requestId: string,
    dto: UpdateSocRequestStatusDto,
  ) {
    const request = await this.prisma.socRequest.findFirst({
      where: { id: requestId, tenant_id: tenantId },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    const allowed = ALLOWED_TRANSITIONS[request.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `No se puede pasar de ${STATUS_LABEL[request.status]} a ${STATUS_LABEL[dto.status]}`,
      );
    }

    const now = new Date();
    const update: any = { status: dto.status, updated_at: now };

    if (dto.priority) update.priority = dto.priority;
    if (dto.assigned_to_id !== undefined) update.assigned_to_id = dto.assigned_to_id;

    if (dto.status === 'IN_PROGRESS' && !request.started_at) update.started_at = now;
    if (dto.status === 'APPROVED') update.approved_at = now;
    if (dto.status === 'IN_REVIEW' || dto.status === 'CLOSED') {
      update.completed_at = now;
      if (request.started_at) {
        update.resolution_hours = (now.getTime() - request.started_at.getTime()) / 3_600_000;
      }
    }
    if (dto.status === 'ACCEPTED') update.accepted_at = now;
    if (dto.status === 'CLOSED') update.closed_at = now;

    // Verificar SLA
    if (request.due_date && now > request.due_date && !request.sla_breached) {
      update.sla_breached = true;
    }

    const updated = await this.prisma.socRequest.update({
      where: { id: requestId },
      data: update,
      include: this.requestIncludes(),
    });

    if (dto.assigned_to_id) {
      await this.recordHistory(requestId, slotId, 'assigned', undefined, dto.assigned_to_id, dto.notes);
    }
    await this.recordHistory(requestId, slotId, 'status_changed', request.status, dto.status, dto.notes);

    return updated;
  }

  // ── Comentarios ───────────────────────────────────────────────────────────

  async addComment(tenantId: string, slotId: string, requestId: string, dto: AddSocCommentDto) {
    await this.assertRequestAccess(tenantId, requestId);
    const comment = await this.prisma.socComment.create({
      data: {
        request_id: requestId,
        slot_id: slotId,
        content: dto.content,
        is_internal: dto.is_internal ?? false,
      },
      include: { slot: { select: { id: true, name: true, avatar_url: true, type: true } } },
    });
    await this.recordHistory(requestId, slotId, 'comment_added');
    return comment;
  }

  // ── Aprobaciones ──────────────────────────────────────────────────────────

  async decideApproval(
    tenantId: string,
    slotId: string,
    requestId: string,
    approvalId: string,
    dto: DecideSocApprovalDto,
  ) {
    const approval = await this.prisma.socApproval.findFirst({
      where: { id: approvalId, request_id: requestId, approver_id: slotId },
    });
    if (!approval) throw new ForbiddenException('No tienes permiso para aprobar esta solicitud');
    if (approval.status !== 'pending') {
      throw new BadRequestException('Esta aprobación ya fue procesada');
    }

    await this.prisma.socApproval.update({
      where: { id: approvalId },
      data: { status: dto.decision, notes: dto.notes, decided_at: new Date() },
    });

    // Si se rechaza, la solicitud pasa a REJECTED
    if (dto.decision === 'rejected') {
      await this.updateStatus(tenantId, slotId, requestId, { status: 'REJECTED', notes: dto.notes });
    } else {
      // Si todas las aprobaciones pendientes del mismo paso están aprobadas → pasar a siguiente paso o APPROVED
      const pendingInStep = await this.prisma.socApproval.count({
        where: { request_id: requestId, step: approval.step, status: 'pending' },
      });
      if (pendingInStep === 0) {
        const nextStep = await this.prisma.socApproval.findFirst({
          where: { request_id: requestId, step: { gt: approval.step }, status: 'pending' },
          orderBy: { step: 'asc' },
        });
        if (!nextStep) {
          await this.updateStatus(tenantId, slotId, requestId, { status: 'APPROVED', notes: 'Todas las aprobaciones completadas' });
        }
      }
    }

    await this.recordHistory(requestId, slotId, dto.decision === 'approved' ? 'approved' : 'rejected', undefined, undefined, dto.notes);
    return { success: true };
  }

  // ── Analítica básica ──────────────────────────────────────────────────────

  async getAnalytics(tenantId: string, departmentId?: string) {
    const where: any = { tenant_id: tenantId };
    if (departmentId) where.service = { department_id: departmentId };

    const [byStatus, byPriority, total, breached, avgResolution] = await Promise.all([
      this.prisma.socRequest.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.socRequest.groupBy({ by: ['priority'], where, _count: true }),
      this.prisma.socRequest.count({ where }),
      this.prisma.socRequest.count({ where: { ...where, sla_breached: true } }),
      this.prisma.socRequest.aggregate({
        where: { ...where, resolution_hours: { not: null } },
        _avg: { resolution_hours: true },
      }),
    ]);

    return {
      total,
      sla_breached: breached,
      sla_compliance_pct: total > 0 ? Math.round(((total - breached) / total) * 100) : 100,
      avg_resolution_hours: Math.round((avgResolution._avg.resolution_hours ?? 0) * 10) / 10,
      by_status: byStatus.map(r => ({ status: r.status, count: r._count })),
      by_priority: byPriority.map(r => ({ priority: r.priority, count: r._count })),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private requestIncludes() {
    return {
      service: {
        select: {
          id: true, name: true, icon: true, color: true, sla_hours: true,
          requires_approval: true, form_schema: true,
          department: { select: { id: true, name: true, color: true, icon: true } },
        },
      },
      requester: { select: { id: true, name: true, avatar_url: true, email: true } },
      assigned_to: { select: { id: true, name: true, avatar_url: true } },
    };
  }

  private async generateRequestNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.socRequest.count({
      where: { tenant_id: tenantId, created_at: { gte: new Date(`${year}-01-01`) } },
    });
    return `SOC-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private async assertRequestAccess(tenantId: string, requestId: string) {
    const exists = await this.prisma.socRequest.count({
      where: { id: requestId, tenant_id: tenantId },
    });
    if (!exists) throw new NotFoundException('Solicitud no encontrada');
  }

  private async recordHistory(
    requestId: string,
    slotId: string | undefined,
    action: string,
    fromValue?: string,
    toValue?: string,
    notes?: string,
  ) {
    await this.prisma.socHistory.create({
      data: { request_id: requestId, slot_id: slotId, action, from_value: fromValue, to_value: toValue, notes },
    });
  }
}
