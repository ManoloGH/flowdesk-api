import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateContactDto, UpdateContactDto, AddActivityDto, CreateDealDto } from './dto/contact.dto';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  // ─── Contacts ─────────────────────────────────────────────────────────────────

  async create(tenantId: string, actorSlotId: string, dto: CreateContactDto) {
    return this.prisma.contact.create({
      data: {
        tenant_id: tenantId,
        owner_slot_id: dto.owner_slot_id ?? actorSlotId,
        first_name: dto.first_name,
        last_name: dto.last_name,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        position: dto.position,
        status: dto.status ?? 'lead',
        tags: dto.tags ?? [],
        custom_fields: dto.custom_fields ?? {},
      },
      include: {
        owner_slot: { select: { id: true, name: true, avatar_url: true } },
      },
    });
  }

  async findAll(tenantId: string, filter?: { status?: string; owner_slot_id?: string; search?: string }) {
    const where: any = { tenant_id: tenantId };
    if (filter?.status) where.status = filter.status;
    if (filter?.owner_slot_id) where.owner_slot_id = filter.owner_slot_id;
    if (filter?.search) {
      where.OR = [
        { first_name: { contains: filter.search, mode: 'insensitive' } },
        { last_name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
        { phone: { contains: filter.search, mode: 'insensitive' } },
        { company: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.contact.findMany({
      where,
      include: {
        owner_slot: { select: { id: true, name: true, avatar_url: true } },
        _count: { select: { activities: true, deals: true } },
      },
      orderBy: [{ last_contact_at: 'desc' }, { created_at: 'desc' }],
    });
  }

  async findOne(tenantId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, tenant_id: tenantId },
      include: {
        owner_slot: { select: { id: true, name: true, avatar_url: true } },
        activities: { orderBy: { created_at: 'desc' }, take: 50 },
        deals: {
          include: {
            stage: { select: { id: true, name: true, color: true } },
            pipeline: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    return contact;
  }

  async update(tenantId: string, contactId: string, dto: UpdateContactDto) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenant_id: tenantId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');

    return this.prisma.contact.update({
      where: { id: contactId },
      data: { ...dto, last_contact_at: new Date() },
    });
  }

  async delete(tenantId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenant_id: tenantId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    await this.prisma.contact.delete({ where: { id: contactId } });
    return { deleted: true };
  }

  // ─── Activities ───────────────────────────────────────────────────────────────

  async addActivity(tenantId: string, actorSlotId: string, contactId: string, dto: AddActivityDto) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenant_id: tenantId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');

    const [activity] = await Promise.all([
      this.prisma.contactActivity.create({
        data: {
          contact_id: contactId,
          tenant_id: tenantId,
          actor_id: actorSlotId,
          activity_type: dto.activity_type,
          content: dto.content,
          metadata: dto.metadata,
        },
      }),
      this.prisma.contact.update({
        where: { id: contactId },
        data: { last_contact_at: new Date() },
      }),
    ]);

    return activity;
  }

  // ─── Deals ────────────────────────────────────────────────────────────────────

  async createDeal(tenantId: string, ownerSlotId: string, contactId: string, dto: CreateDealDto) {
    const contact = await this.prisma.contact.findFirst({ where: { id: contactId, tenant_id: tenantId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');

    return this.prisma.deal.create({
      data: {
        tenant_id: tenantId,
        pipeline_id: dto.pipeline_id,
        stage_id: dto.stage_id,
        contact_id: contactId,
        owner_id: ownerSlotId,
        title: dto.title,
        value: dto.value,
        currency: dto.currency ?? 'MXN',
        expected_close: dto.expected_close ? new Date(dto.expected_close) : undefined,
      },
      include: {
        stage: { select: { id: true, name: true, color: true } },
        pipeline: { select: { id: true, name: true } },
      },
    });
  }

  async updateDealStage(tenantId: string, dealId: string, stageId: string, status?: string) {
    const deal = await this.prisma.deal.findFirst({ where: { id: dealId, tenant_id: tenantId } });
    if (!deal) throw new NotFoundException('Deal no encontrado');

    const data: any = { stage_id: stageId };
    if (status) {
      data.status = status;
      if (status === 'won' || status === 'lost') data.closed_at = new Date();
    }

    return this.prisma.deal.update({ where: { id: dealId }, data });
  }

  // ─── Pipelines ────────────────────────────────────────────────────────────────

  async createPipeline(tenantId: string, dto: { name: string; pipeline_type?: string; department_id?: string }) {
    const pipeline = await this.prisma.pipeline.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        pipeline_type: dto.pipeline_type ?? 'sales',
        department_id: dto.department_id,
      },
    });

    // Crear etapas por defecto
    const defaultStages =
      dto.pipeline_type === 'support'
        ? ['Nuevo', 'En proceso', 'Esperando cliente', 'Resuelto']
        : ['Prospecto', 'Contactado', 'Propuesta enviada', 'Negociación', 'Cerrado ganado'];

    await this.prisma.$transaction(
      defaultStages.map((name, i) =>
        this.prisma.pipelineStage.create({
          data: { pipeline_id: pipeline.id, tenant_id: tenantId, name, order_index: i + 1 },
        }),
      ),
    );

    return this.prisma.pipeline.findUnique({
      where: { id: pipeline.id },
      include: { stages: { orderBy: { order_index: 'asc' } } },
    });
  }

  async listPipelines(tenantId: string) {
    return this.prisma.pipeline.findMany({
      where: { tenant_id: tenantId, is_active: true },
      include: {
        stages: { orderBy: { order_index: 'asc' } },
        _count: { select: { deals: true } },
      },
    });
  }

  async getPipelineBoard(tenantId: string, pipelineId: string) {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, tenant_id: tenantId },
      include: {
        stages: {
          orderBy: { order_index: 'asc' },
          include: {
            deals: {
              where: { status: 'open' },
              include: {
                contact: { select: { id: true, first_name: true, last_name: true, company: true } },
                owner: { select: { id: true, name: true, avatar_url: true } },
              },
              orderBy: { created_at: 'desc' },
            },
          },
        },
      },
    });
    if (!pipeline) throw new NotFoundException('Pipeline no encontrado');
    return pipeline;
  }
}
