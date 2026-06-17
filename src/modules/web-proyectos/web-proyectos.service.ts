import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateWebProyectoDto, UpdateWebProyectoDto } from './dto/web-proyecto.dto';

const FASE_ORDER = ['setup', 'assets', 'video', 'construccion', 'scroll', 'seo', 'publicado', 'entregado'];

@Injectable()
export class WebProyectosService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, slotId: string | undefined, dto: CreateWebProyectoDto) {
    const existing = await this.prisma.webProyecto.findUnique({
      where: { tenant_id_slug: { tenant_id: tenantId, slug: dto.slug } },
    });
    if (existing) throw new ConflictException(`Ya existe un proyecto con slug "${dto.slug}"`);

    return this.prisma.webProyecto.create({
      data: {
        tenant_id: tenantId,
        created_by_id: slotId,
        ...dto,
      },
    });
  }

  async findAll(tenantId: string, fase?: string) {
    return this.prisma.webProyecto.findMany({
      where: { tenant_id: tenantId, ...(fase ? { fase } : {}) },
      orderBy: { updated_at: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const proyecto = await this.prisma.webProyecto.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!proyecto) throw new NotFoundException('Proyecto web no encontrado');
    return proyecto;
  }

  async update(tenantId: string, id: string, dto: UpdateWebProyectoDto) {
    await this.findOne(tenantId, id);
    return this.prisma.webProyecto.update({
      where: { id },
      data: { ...dto, updated_at: new Date() },
    });
  }

  async avanzarFase(tenantId: string, id: string) {
    const proyecto = await this.findOne(tenantId, id);
    const idx = FASE_ORDER.indexOf(proyecto.fase);
    if (idx === -1 || idx >= FASE_ORDER.length - 1) return proyecto;
    return this.prisma.webProyecto.update({
      where: { id },
      data: { fase: FASE_ORDER[idx + 1], updated_at: new Date() },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.webProyecto.delete({ where: { id } });
  }

  stats(tenantId: string) {
    return this.prisma.webProyecto.groupBy({
      by: ['fase'],
      where: { tenant_id: tenantId },
      _count: { id: true },
    });
  }
}
