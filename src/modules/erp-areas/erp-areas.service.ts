import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateErpRequirementDto, UpdateErpRequirementDto,
  CreateErpServiceDto, UpdateErpServiceDto,
  CreateErpFeedbackDto,
} from './dto/erp.dto';

const PHASE_ORDER = ['LEVANTAMIENTO','CONFIGURACION','PRUEBA','AJUSTE','APROBADO','PRODUCCION'];

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  LEVANTAMIENTO: ['CONFIGURACION','CANCELADO'],
  CONFIGURACION: ['PRUEBA','LEVANTAMIENTO','CANCELADO'],
  PRUEBA:        ['AJUSTE','APROBADO','CANCELADO'],
  AJUSTE:        ['PRUEBA','CANCELADO'],
  APROBADO:      ['PRODUCCION','CANCELADO'],
  PRODUCCION:    [],
  CANCELADO:     [],
};

@Injectable()
export class ErpAreasService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Requerimientos ────────────────────────────────────────────────────────

  async listRequirements(tenantId: string, departmentId?: string) {
    return this.prisma.erpRequirement.findMany({
      where: {
        tenant_id: tenantId,
        ...(departmentId ? { department_id: departmentId } : {}),
        status: { not: 'CANCELADO' },
      },
      include: {
        department: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        erp_services: { select: { id: true, name: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getRequirement(tenantId: string, id: string) {
    const req = await this.prisma.erpRequirement.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        department: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true, avatar: true } },
        erp_services: {
          orderBy: { created_at: 'asc' },
        },
        erp_feedbacks: {
          include: { slot: { select: { id: true, name: true, avatar: true } } },
          orderBy: { created_at: 'desc' },
        },
      },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado');
    return req;
  }

  async createRequirement(tenantId: string, slotId: string, dto: CreateErpRequirementDto) {
    return this.prisma.erpRequirement.create({
      data: {
        tenant_id: tenantId,
        department_id: dto.department_id,
        owner_slot_id: slotId,
        name: dto.name,
        status: 'LEVANTAMIENTO',
        current_tools: dto.current_tools,
        current_pain: dto.current_pain,
        monthly_volume: dto.monthly_volume,
        notes: dto.notes,
        levantamiento_at: new Date(),
      },
    });
  }

  async updateRequirement(tenantId: string, slotId: string, id: string, dto: UpdateErpRequirementDto) {
    const req = await this.prisma.erpRequirement.findFirst({ where: { id, tenant_id: tenantId } });
    if (!req) throw new NotFoundException('Requerimiento no encontrado');

    const updateData: any = { ...dto };

    if (dto.status && dto.status !== req.status) {
      const allowed = ALLOWED_TRANSITIONS[req.status] ?? [];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(
          `No se puede pasar de ${req.status} a ${dto.status}`,
        );
      }
      const tsField = this.phaseTimestamp(dto.status);
      if (tsField) updateData[tsField] = new Date();
    }

    return this.prisma.erpRequirement.update({ where: { id }, data: updateData });
  }

  // ── Acción especial: Aprobar → PRODUCCION ─────────────────────────────────

  async deployToProduction(tenantId: string, id: string) {
    const req = await this.prisma.erpRequirement.findFirst({
      where: { id, tenant_id: tenantId },
      include: { erp_services: true, department: true },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado');
    if (req.status !== 'APROBADO') {
      throw new BadRequestException('Solo se puede desplegar un requerimiento en estado APROBADO');
    }

    const approvedServices = req.erp_services.filter((s: any) => s.status === 'APROBADO');
    if (approvedServices.length === 0) {
      throw new BadRequestException('No hay servicios aprobados para desplegar');
    }

    const created: any[] = [];
    for (const svc of approvedServices) {
      const socSvc = await this.prisma.socService.create({
        data: {
          tenant_id: tenantId,
          department_id: req.department_id,
          name: svc.name,
          description: svc.description,
          category: svc.category,
          icon: svc.icon ?? 'Box',
          color: svc.color ?? '#6366f1',
          sla_hours: svc.sla_hours ?? 48,
          sla_warning_pct: 80,
          requires_approval: svc.requires_approval ?? false,
          approval_flow: svc.approval_flow ?? [],
          form_schema: svc.form_schema ?? [],
          auto_agent_id: svc.auto_agent_id,
          auto_respond: svc.auto_respond ?? false,
          visible_to: 'all',
          visible_roles: [],
          is_active: true,
        },
      });

      await this.prisma.erpService.update({
        where: { id: svc.id },
        data: { soc_service_id: socSvc.id },
      });

      created.push(socSvc);
    }

    await this.prisma.erpRequirement.update({
      where: { id },
      data: { status: 'PRODUCCION', produccion_at: new Date() },
    });

    return {
      deployed: created.length,
      soc_services: created.map((s) => ({ id: s.id, name: s.name })),
    };
  }

  // ── Servicios del requerimiento ───────────────────────────────────────────

  async listServices(tenantId: string, requirementId: string) {
    await this.assertRequirement(tenantId, requirementId);
    return this.prisma.erpService.findMany({
      where: { requirement_id: requirementId },
      orderBy: { created_at: 'asc' },
    });
  }

  async createService(tenantId: string, requirementId: string, dto: CreateErpServiceDto) {
    const req = await this.assertRequirement(tenantId, requirementId);
    if (req.status === 'PRODUCCION' || req.status === 'CANCELADO') {
      throw new BadRequestException('No se pueden agregar servicios a este requerimiento');
    }
    return this.prisma.erpService.create({
      data: {
        requirement_id: requirementId,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        icon: dto.icon,
        color: dto.color,
        current_process: dto.current_process,
        pain_points: dto.pain_points,
        requester_profile: dto.requester_profile,
        delivered_how: dto.delivered_how,
        monthly_volume: dto.monthly_volume,
        sla_hours: dto.sla_hours,
        requires_approval: dto.requires_approval ?? false,
        approval_flow: dto.approval_flow ?? [],
        form_schema: dto.form_schema ?? [],
        auto_agent_id: dto.auto_agent_id,
        auto_respond: dto.auto_respond ?? false,
        status: 'BORRADOR',
      },
    });
  }

  async updateService(tenantId: string, requirementId: string, serviceId: string, dto: UpdateErpServiceDto) {
    await this.assertRequirement(tenantId, requirementId);
    const svc = await this.prisma.erpService.findFirst({ where: { id: serviceId, requirement_id: requirementId } });
    if (!svc) throw new NotFoundException('Servicio no encontrado');
    return this.prisma.erpService.update({ where: { id: serviceId }, data: dto });
  }

  async deleteService(tenantId: string, requirementId: string, serviceId: string) {
    await this.assertRequirement(tenantId, requirementId);
    await this.prisma.erpService.delete({ where: { id: serviceId } });
    return { ok: true };
  }

  // ── Retroalimentación ─────────────────────────────────────────────────────

  async listFeedbacks(tenantId: string, requirementId: string) {
    await this.assertRequirement(tenantId, requirementId);
    return this.prisma.erpFeedback.findMany({
      where: { requirement_id: requirementId },
      include: { slot: { select: { id: true, name: true, avatar: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async addFeedback(tenantId: string, requirementId: string, slotId: string, dto: CreateErpFeedbackDto) {
    await this.assertRequirement(tenantId, requirementId);
    return this.prisma.erpFeedback.create({
      data: {
        requirement_id: requirementId,
        slot_id: slotId,
        type: dto.type,
        content: dto.content,
        service_refs: dto.service_refs ?? [],
      },
    });
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private async assertRequirement(tenantId: string, requirementId: string) {
    const req = await this.prisma.erpRequirement.findFirst({ where: { id: requirementId, tenant_id: tenantId } });
    if (!req) throw new NotFoundException('Requerimiento no encontrado');
    return req;
  }

  private phaseTimestamp(status: string): string | null {
    const map: Record<string, string> = {
      LEVANTAMIENTO: 'levantamiento_at',
      CONFIGURACION: 'configuracion_at',
      PRUEBA:        'prueba_at',
      APROBADO:      'aprobado_at',
      PRODUCCION:    'produccion_at',
    };
    return map[status] ?? null;
  }
}
