import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ImplementationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.implementation.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      include: {
        check_items: true,
        notes: { orderBy: { created_at: 'desc' }, take: 1 },
        _count: { select: { check_items: true, notes: true, files: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const impl = await this.prisma.implementation.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        check_items: { orderBy: { phase: 'asc' } },
        notes: { orderBy: { created_at: 'asc' } },
        files: { orderBy: { uploaded_at: 'desc' } },
        messages: { orderBy: { created_at: 'asc' }, take: 100 },
      },
    });
    if (!impl) throw new NotFoundException('Implementation not found');
    return impl;
  }

  async create(tenantId: string, data: { client_name: string; client_info?: any }) {
    return this.prisma.implementation.create({
      data: {
        tenant_id: tenantId,
        client_name: data.client_name,
        client_info: data.client_info ?? {},
        phase: 0,
        status: 'in_progress',
      },
    });
  }

  async update(tenantId: string, id: string, data: { phase?: number; status?: string; client_info?: any; completed_at?: Date }) {
    await this.findOne(tenantId, id);
    return this.prisma.implementation.update({
      where: { id },
      data,
    });
  }

  async toggleCheck(tenantId: string, implId: string, checkId: string, phase: number, checked: boolean) {
    await this.findOne(tenantId, implId);
    return this.prisma.implementationCheckItem.upsert({
      where: { implementation_id_check_id: { implementation_id: implId, check_id: checkId } },
      create: {
        implementation_id: implId,
        check_id: checkId,
        phase,
        checked,
        checked_at: checked ? new Date() : null,
      },
      update: {
        checked,
        checked_at: checked ? new Date() : null,
      },
    });
  }

  async addNote(tenantId: string, implId: string, data: { phase: number; content: string; created_by?: string }) {
    await this.findOne(tenantId, implId);
    return this.prisma.implementationNote.create({
      data: {
        implementation_id: implId,
        phase: data.phase,
        content: data.content,
        created_by: data.created_by,
      },
    });
  }

  async deleteNote(tenantId: string, implId: string, noteId: string) {
    await this.findOne(tenantId, implId);
    return this.prisma.implementationNote.delete({ where: { id: noteId } });
  }

  async addFile(tenantId: string, implId: string, data: { phase: number; name: string; url: string }) {
    await this.findOne(tenantId, implId);
    return this.prisma.implementationFile.create({
      data: { implementation_id: implId, ...data },
    });
  }

  async deleteFile(tenantId: string, implId: string, fileId: string) {
    await this.findOne(tenantId, implId);
    return this.prisma.implementationFile.delete({ where: { id: fileId } });
  }

  async saveMessage(implId: string, role: 'user' | 'assistant', content: string, phase?: number) {
    return this.prisma.implementationMessage.create({
      data: { implementation_id: implId, role, content, phase },
    });
  }

  async getMessages(tenantId: string, implId: string) {
    await this.findOne(tenantId, implId);
    return this.prisma.implementationMessage.findMany({
      where: { implementation_id: implId },
      orderBy: { created_at: 'asc' },
    });
  }
}
