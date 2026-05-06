import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateMapPropDto, UpdateMapPropDto, UpdateCampusConfigDto } from './dto/map-prop.dto';

// Templates de campus por industria — coordenadas base para el canvas PixiJS
const CAMPUS_TEMPLATES: Record<string, any> = {
  corporate: {
    background_color: '#1a1a2e',
    grid_size: 32,
    default_rooms: [
      { name: 'Dirección', x: 0, y: 0, width: 320, height: 192, color: '#312E81' },
      { name: 'Ventas', x: 320, y: 0, width: 352, height: 192, color: '#065F46' },
      { name: 'Servicio al Cliente', x: 672, y: 0, width: 320, height: 192, color: '#1E3A5F' },
      { name: 'RRHH', x: 0, y: 192, width: 256, height: 192, color: '#7C2D12' },
      { name: 'Operaciones', x: 256, y: 192, width: 384, height: 192, color: '#374151' },
      { name: 'Sala de Juntas A', x: 640, y: 192, width: 192, height: 192, color: '#4B5563' },
      { name: 'Sala de Juntas B', x: 832, y: 192, width: 160, height: 192, color: '#4B5563' },
      { name: 'Administración', x: 0, y: 384, width: 256, height: 192, color: '#1F2937' },
      { name: 'Contabilidad', x: 256, y: 384, width: 256, height: 192, color: '#1F2937' },
      { name: 'Marketing', x: 512, y: 384, width: 256, height: 192, color: '#4C1D95' },
      { name: 'Cafetería', x: 768, y: 384, width: 224, height: 192, color: '#78350F' },
    ],
  },
  startup: {
    background_color: '#0f172a',
    grid_size: 32,
    default_rooms: [
      { name: 'Open Space', x: 0, y: 0, width: 576, height: 288, color: '#1e293b' },
      { name: 'Sala de Reuniones', x: 576, y: 0, width: 256, height: 288, color: '#312E81' },
      { name: 'Zona de Descanso', x: 0, y: 288, width: 256, height: 192, color: '#78350F' },
      { name: 'Dirección', x: 256, y: 288, width: 256, height: 192, color: '#065F46' },
      { name: 'Ventas', x: 512, y: 288, width: 320, height: 192, color: '#1E3A5F' },
    ],
  },
  real_estate: {
    background_color: '#1a2332',
    grid_size: 32,
    default_rooms: [
      { name: 'Sala de Ventas', x: 0, y: 0, width: 480, height: 256, color: '#065F46' },
      { name: 'Sala de Firmas', x: 480, y: 0, width: 256, height: 256, color: '#312E81' },
      { name: 'Archivo', x: 736, y: 0, width: 256, height: 256, color: '#374151' },
      { name: 'Administración', x: 0, y: 256, width: 320, height: 192, color: '#1F2937' },
      { name: 'Sala de Juntas', x: 320, y: 256, width: 320, height: 192, color: '#4B5563' },
      { name: 'Descanso', x: 640, y: 256, width: 352, height: 192, color: '#78350F' },
    ],
  },
  construction: {
    background_color: '#1c1a0e',
    grid_size: 32,
    default_rooms: [
      { name: 'Sala de Planos', x: 0, y: 0, width: 416, height: 256, color: '#374151' },
      { name: 'Administración', x: 416, y: 0, width: 320, height: 256, color: '#1F2937' },
      { name: 'Bodega', x: 736, y: 0, width: 256, height: 256, color: '#78350F' },
      { name: 'Sala de Juntas', x: 0, y: 256, width: 320, height: 192, color: '#4B5563' },
      { name: 'RRHH', x: 320, y: 256, width: 256, height: 192, color: '#7C2D12' },
      { name: 'Contabilidad', x: 576, y: 256, width: 256, height: 192, color: '#065F46' },
    ],
  },
};

@Injectable()
export class MapPropsService {
  constructor(private prisma: PrismaService) {}

  // ─── Props ────────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateMapPropDto) {
    return this.prisma.mapProp.create({
      data: { tenant_id: tenantId, ...dto },
    });
  }

  async findAll(tenantId: string, roomId?: string) {
    return this.prisma.mapProp.findMany({
      where: { tenant_id: tenantId, is_active: true, ...(roomId ? { room_id: roomId } : {}) },
      orderBy: { created_at: 'asc' },
    });
  }

  async update(tenantId: string, propId: string, dto: UpdateMapPropDto) {
    const prop = await this.prisma.mapProp.findFirst({ where: { id: propId, tenant_id: tenantId } });
    if (!prop) throw new NotFoundException('Prop no encontrado');
    return this.prisma.mapProp.update({ where: { id: propId }, data: dto as any });
  }

  async remove(tenantId: string, propId: string) {
    const prop = await this.prisma.mapProp.findFirst({ where: { id: propId, tenant_id: tenantId } });
    if (!prop) throw new NotFoundException('Prop no encontrado');
    await this.prisma.mapProp.delete({ where: { id: propId } });
    return { deleted: true };
  }

  // ─── Campus config ────────────────────────────────────────────────────────

  async getCampusConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { campus_config: true },
    });
    return tenant?.campus_config ?? { map_source: 'template', map_template: 'corporate' };
  }

  async updateCampusConfig(tenantId: string, dto: UpdateCampusConfigDto) {
    const current = (await this.getCampusConfig(tenantId) as any) ?? {};
    const updated = { ...current, ...dto };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { campus_config: updated },
    });

    // Si se elige un template, crear las salas por defecto automáticamente
    if (dto.map_template && dto.map_source === 'template') {
      await this.applyTemplate(tenantId, dto.map_template);
    }

    return updated;
  }

  async getTemplates() {
    return Object.entries(CAMPUS_TEMPLATES).map(([key, t]) => ({
      key,
      background_color: t.background_color,
      rooms_count: t.default_rooms.length,
      preview_url: `/assets/campus-templates/${key}.png`,
    }));
  }

  // Aplica un template creando las salas en la DB
  private async applyTemplate(tenantId: string, templateKey: string) {
    const template = CAMPUS_TEMPLATES[templateKey];
    if (!template) return;

    // Borrar salas existentes y crear las del template
    await this.prisma.room.deleteMany({ where: { tenant_id: tenantId } });

    await this.prisma.$transaction(
      template.default_rooms.map((r: any) =>
        this.prisma.room.create({
          data: {
            tenant_id: tenantId,
            name: r.name,
            room_type: 'department',
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            color: r.color,
          },
        }),
      ),
    );
  }

  // Snapshot completo del campus para el cliente OFFICE
  async getCampusSnapshot(tenantId: string) {
    const [config, rooms, props] = await Promise.all([
      this.getCampusConfig(tenantId),
      this.prisma.room.findMany({ where: { tenant_id: tenantId, is_active: true } }),
      this.prisma.mapProp.findMany({ where: { tenant_id: tenantId, is_active: true } }),
    ]);

    return { config, rooms, props };
  }
}
