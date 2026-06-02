import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';

export class VaultSetDto {
  key_name: string;
  value: string;
  category?: string;
  description?: string;
}

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async set(tenantId: string, dto: VaultSetDto, actorId: string): Promise<{ key_name: string }> {
    const encrypted_value = this.encryption.encrypt(dto.value);

    const entry = await this.prisma.vaultEntry.upsert({
      where: { tenant_id_key_name: { tenant_id: tenantId, key_name: dto.key_name } },
      create: {
        tenant_id:       tenantId,
        key_name:        dto.key_name,
        encrypted_value,
        category:        dto.category ?? 'other',
        description:     dto.description,
      },
      update: {
        encrypted_value,
        category:    dto.category ?? 'other',
        description: dto.description,
        updated_at:  new Date(),
      },
    });

    await this.prisma.vaultAccessLog.create({
      data: { entry_id: entry.id, accessor: actorId, action: 'write' },
    });

    return { key_name: entry.key_name };
  }

  async get(tenantId: string, keyName: string, actorId: string): Promise<string> {
    const entry = await this.prisma.vaultEntry.findUnique({
      where: { tenant_id_key_name: { tenant_id: tenantId, key_name: keyName } },
    });
    if (!entry) throw new NotFoundException(`Vault key "${keyName}" not found`);

    await this.prisma.vaultAccessLog.create({
      data: { entry_id: entry.id, accessor: actorId, action: 'read' },
    });

    return this.encryption.decrypt(entry.encrypted_value);
  }

  async list(tenantId: string) {
    return this.prisma.vaultEntry.findMany({
      where: { tenant_id: tenantId },
      select: {
        id:          true,
        key_name:    true,
        category:    true,
        description: true,
        created_at:  true,
        updated_at:  true,
      },
      orderBy: [{ category: 'asc' }, { key_name: 'asc' }],
    });
  }

  async delete(tenantId: string, keyName: string, actorId: string): Promise<void> {
    const entry = await this.prisma.vaultEntry.findUnique({
      where: { tenant_id_key_name: { tenant_id: tenantId, key_name: keyName } },
    });
    if (!entry) throw new NotFoundException(`Vault key "${keyName}" not found`);

    await this.prisma.vaultAccessLog.create({
      data: { entry_id: entry.id, accessor: actorId, action: 'delete' },
    });

    await this.prisma.vaultEntry.delete({
      where: { tenant_id_key_name: { tenant_id: tenantId, key_name: keyName } },
    });
  }

  async getByCategory(tenantId: string, category: string) {
    const entries = await this.prisma.vaultEntry.findMany({
      where: { tenant_id: tenantId, category },
      select: { key_name: true, encrypted_value: true },
    });

    return Object.fromEntries(
      entries.map(e => [e.key_name, this.encryption.decrypt(e.encrypted_value)]),
    );
  }

  async getSystemValue(tenantId: string, keyName: string): Promise<string | null> {
    const entry = await this.prisma.vaultEntry.findUnique({
      where: { tenant_id_key_name: { tenant_id: tenantId, key_name: keyName } },
    });
    if (!entry) return null;

    await this.prisma.vaultAccessLog.create({
      data: { entry_id: entry.id, accessor: 'system', action: 'read' },
    });

    return this.encryption.decrypt(entry.encrypted_value);
  }
}
