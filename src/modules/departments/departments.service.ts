import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string) {
    const departments = await this.prisma.department.findMany({
      where: { tenant_id: tenantId },
      include: {
        children: { select: { id: true, name: true, color: true, icon: true } },
        _count: { select: { team_slots: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Solo devolver los de nivel raíz — sus hijos ya vienen anidados
    return departments.filter(d => !d.parent_id);
  }

  async findOne(id: string, tenantId: string) {
    const dept = await this.prisma.department.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, color: true, icon: true } },
        team_slots: {
          select: { id: true, name: true, role: true, type: true, status: true, avatar_url: true },
        },
        _count: { select: { team_slots: true } },
      },
    });
    if (!dept) throw new NotFoundException('Departamento no encontrado');
    return dept;
  }

  async create(tenantId: string, dto: CreateDepartmentDto) {
    if (dto.parent_id) {
      const parent = await this.prisma.department.findFirst({
        where: { id: dto.parent_id, tenant_id: tenantId },
      });
      if (!parent) throw new BadRequestException('El departamento padre no existe en tu empresa');
    }

    return this.prisma.department.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        color: dto.color ?? '#6366F1',
        icon: dto.icon,
        parent_id: dto.parent_id,
      },
    });
  }

  async update(id: string, tenantId: string, dto: UpdateDepartmentDto) {
    await this.findOne(id, tenantId);

    if (dto.parent_id === id) {
      throw new BadRequestException('Un departamento no puede ser su propio padre');
    }

    return this.prisma.department.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, tenantId: string) {
    const dept = await this.findOne(id, tenantId);

    if (dept._count.team_slots > 0) {
      throw new BadRequestException(
        `No puedes eliminar "${dept.name}" — tiene ${dept._count.team_slots} miembro(s). Muévelos primero.`,
      );
    }

    await this.prisma.department.delete({ where: { id } });
    return { message: `Departamento "${dept.name}" eliminado` };
  }
}
