import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateScheduleDto } from './dto/schedule.dto';

@Injectable()
export class SchedulesService {
  constructor(private prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.schedule.findMany({
      where: { tenant_id: tenantId },
      include: { _count: { select: { team_slots: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const s = await this.prisma.schedule.findFirst({ where: { id, tenant_id: tenantId } });
    if (!s) throw new NotFoundException('Horario no encontrado');
    return s;
  }

  create(tenantId: string, dto: CreateScheduleDto) {
    return this.prisma.schedule.create({
      data: { tenant_id: tenantId, ...dto },
    });
  }

  async update(id: string, tenantId: string, dto: Partial<CreateScheduleDto>) {
    await this.findOne(id, tenantId);
    return this.prisma.schedule.update({ where: { id }, data: dto });
  }

  async remove(id: string, tenantId: string) {
    await this.findOne(id, tenantId);
    await this.prisma.schedule.delete({ where: { id } });
    return { message: 'Horario eliminado' };
  }
}
