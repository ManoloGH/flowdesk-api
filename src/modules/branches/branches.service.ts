import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class BranchesService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async list(networkTenantId: string) {
    return this.prisma.tenant.findMany({
      where: { network_id: networkTenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo_url: true,
        primary_color: true,
        status: true,
        tenant_type: true,
        created_at: true,
        _count: {
          select: { team_slots: true, contacts: true, departments: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateBranchDto, networkTenantId: string) {
    const network = await this.prisma.tenant.findFirst({
      where: { id: networkTenantId },
      select: { id: true, plan: true },
    });
    if (!network) throw new NotFoundException('Tenant de red no encontrado');

    const slugExists = await this.prisma.tenant.findFirst({ where: { slug: dto.slug } });
    if (slugExists) throw new ConflictException(`El slug "${dto.slug}" ya está en uso`);

    return this.prisma.$transaction(async (tx: any) => {
      const branch = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          primary_color: dto.primary_color ?? '#4F46E5',
          logo_url: dto.logo_url,
          plan: network.plan,
          tenant_type: 'BRANCH',
          network_id: networkTenantId,
        },
      });

      await tx.onboardingProgress.create({
        data: {
          tenant_id: branch.id,
          current_step: 1,
          steps_completed: ['company_created'],
        },
      });

      return branch;
    });
  }

  async stats(branchId: string, requestingTenantId: string, requestingRole: string) {
    const branch = await this.prisma.tenant.findFirst({
      where: { id: branchId },
      select: { id: true, name: true, network_id: true, primary_color: true, logo_url: true, status: true },
    });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');

    if (requestingRole !== 'superadmin' && branch.network_id !== requestingTenantId) {
      throw new ForbiddenException('No tienes acceso a esta sucursal');
    }

    const [humans, agents, online, contacts, tasks] = await Promise.all([
      this.prisma.teamSlot.count({ where: { tenant_id: branchId, type: 'HUMAN' } }),
      this.prisma.teamSlot.count({ where: { tenant_id: branchId, type: 'AI_AGENT' } }),
      this.prisma.teamSlot.count({
        where: { tenant_id: branchId, status: { in: ['ONLINE', 'BUSY'] as any } },
      }),
      this.prisma.contact.count({ where: { tenant_id: branchId } }),
      this.prisma.task.count({
        where: { tenant_id: branchId, status: { in: ['pending', 'in_progress'] } },
      }),
    ]);

    return {
      ...branch,
      humans,
      agents,
      online,
      contacts,
      tasks,
    };
  }

  // Emite un JWT temporal con tenant_id = branchId para que el owner gestione la sucursal
  async enter(
    branchId: string,
    requestingTenantId: string,
    requestingRole: string,
    slotId: string,
    slotEmail: string,
  ) {
    const branch = await this.prisma.tenant.findFirst({
      where: { id: branchId },
      select: { id: true, name: true, network_id: true, tenant_type: true },
    });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');

    if (requestingRole !== 'superadmin' && branch.network_id !== requestingTenantId) {
      throw new ForbiddenException('No tienes acceso a esta sucursal');
    }

    const payload = {
      sub: slotId,
      tenant_id: branchId,
      role: 'admin',
      type: 'HUMAN',
      email: slotEmail,
      tenant_type: 'BRANCH',
      // Extra claim para que el cliente sepa de dónde vino
      network_tenant_id: requestingTenantId,
    };

    return {
      access_token: this.jwt.sign(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      refresh_token: this.jwt.sign(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
      user: {
        slot_id: slotId,
        tenant_id: branchId,
        role: 'admin',
        type: 'HUMAN',
        email: slotEmail,
        tenant_type: 'BRANCH',
      },
      branch: { id: branch.id, name: branch.name },
    };
  }
}
