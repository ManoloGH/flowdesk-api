import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateSocServiceDto, UpdateSocServiceDto } from './dto/soc.dto';

@Injectable()
export class SocCatalogService {
  constructor(private prisma: PrismaService) {}

  async listServices(
    tenantId: string,
    filters: { department_id?: string; category?: string; active_only?: boolean },
  ) {
    const where: any = { tenant_id: tenantId };
    if (filters.department_id) where.department_id = filters.department_id;
    if (filters.category) where.category = filters.category;
    if (filters.active_only !== false) where.is_active = true;

    return this.prisma.socService.findMany({
      where,
      include: {
        department: { select: { id: true, name: true, color: true, icon: true, dept_type: true } },
        auto_agent: { select: { id: true, name: true, avatar_url: true } },
        _count: { select: { requests: true } },
      },
      orderBy: [{ department_id: 'asc' }, { name: 'asc' }],
    });
  }

  async getService(tenantId: string, serviceId: string) {
    const service = await this.prisma.socService.findFirst({
      where: { id: serviceId, tenant_id: tenantId },
      include: {
        department: { select: { id: true, name: true, color: true, icon: true, dept_type: true } },
        auto_agent: { select: { id: true, name: true, avatar_url: true } },
        _count: { select: { requests: true } },
      },
    });
    if (!service) throw new NotFoundException('Servicio no encontrado');
    return service;
  }

  async createService(tenantId: string, slotId: string, dto: CreateSocServiceDto) {
    await this.assertDeptAdmin(tenantId, slotId, dto.department_id);
    return this.prisma.socService.create({
      data: {
        tenant_id: tenantId,
        department_id: dto.department_id,
        name: dto.name,
        description: dto.description,
        category: dto.category,
        icon: dto.icon,
        color: dto.color,
        sla_hours: dto.sla_hours,
        sla_warning_pct: dto.sla_warning_pct,
        requires_approval: dto.requires_approval ?? false,
        approval_flow: dto.approval_flow ?? undefined,
        form_schema: dto.form_schema ?? undefined,
        visible_to: dto.visible_to ?? 'all',
        visible_roles: dto.visible_roles ?? undefined,
        auto_agent_id: dto.auto_agent_id,
        auto_respond: dto.auto_respond ?? false,
      },
      include: {
        department: { select: { id: true, name: true, color: true, icon: true } },
      },
    });
  }

  async updateService(
    tenantId: string,
    slotId: string,
    serviceId: string,
    dto: UpdateSocServiceDto,
  ) {
    const service = await this.getService(tenantId, serviceId);
    await this.assertDeptAdmin(tenantId, slotId, service.department_id);

    const { department_id: _dept, ...rest } = dto;
    return this.prisma.socService.update({
      where: { id: serviceId },
      data: {
        ...rest,
        approval_flow: dto.approval_flow ?? undefined,
        form_schema: dto.form_schema ?? undefined,
        visible_roles: dto.visible_roles ?? undefined,
      },
    });
  }

  async deactivateService(tenantId: string, slotId: string, serviceId: string) {
    const service = await this.getService(tenantId, serviceId);
    await this.assertDeptAdmin(tenantId, slotId, service.department_id);
    return this.prisma.socService.update({
      where: { id: serviceId },
      data: { is_active: false },
    });
  }

  // Solo admins/managers del departamento pueden gestionar el catálogo
  private async assertDeptAdmin(tenantId: string, slotId: string, departmentId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: slotId, tenant_id: tenantId },
      select: { role: true, department_id: true },
    });
    if (!slot) throw new ForbiddenException('Slot no encontrado');
    const isOwner = slot.role === 'owner';
    const isAdmin = slot.role === 'admin';
    const isManagerOfDept = slot.role === 'manager' && slot.department_id === departmentId;
    if (!isOwner && !isAdmin && !isManagerOfDept) {
      throw new ForbiddenException('Solo admins o managers del departamento pueden gestionar el catálogo');
    }
  }

  // Departamentos con sus servicios activos (para la vista del catálogo)
  async getCatalogGrouped(tenantId: string) {
    const services = await this.listServices(tenantId, { active_only: true });

    const groups: Record<string, { department: any; services: any[] }> = {};
    for (const svc of services) {
      const deptId = svc.department_id;
      if (!groups[deptId]) {
        groups[deptId] = { department: svc.department, services: [] };
      }
      groups[deptId].services.push(svc);
    }
    return Object.values(groups);
  }
}
