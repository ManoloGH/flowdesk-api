import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import { AuditService, AuditAction } from '../../common/audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { RegisterSuperAdminDto, ChangePasswordDto } from './dto/register.dto';

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
// Lockout en memoria — suficiente para MVP sin Redis
const loginAttempts = new Map<string, { count: number; lockedUntil?: Date }>();

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  // Crea el super-admin de FlowDesk (solo una vez, protegido por setup_key)
  async registerSuperAdmin(dto: RegisterSuperAdminDto) {
    const setupKey = this.config.get<string>('SETUP_KEY');
    if (setupKey && dto.setup_key !== setupKey) {
      throw new ForbiddenException('Clave de configuración inválida');
    }

    const existing = await this.prisma.teamSlot.findFirst({
      where: { role: 'superadmin' },
    });
    if (existing) {
      throw new ConflictException('El super-admin ya existe');
    }

    // Tenant raíz para el super-admin de FlowDesk
    const tenant = await this.prisma.tenant.create({
      data: { name: 'FlowDesk', slug: 'flowdesk', plan: 'internal' },
    });

    const hash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const slot = await this.prisma.teamSlot.create({
      data: {
        tenant_id: tenant.id,
        name: dto.name,
        email: dto.email,
        password_hash: hash,
        role: 'superadmin',
        type: 'HUMAN',
      },
    });

    return this.buildTokens(slot.id, tenant.id, 'superadmin', 'HUMAN', slot.email!, slot.name);
  }

  async login(dto: LoginDto, ipAddress?: string) {
    this.checkLockout(dto.email);

    const slot = await this.prisma.teamSlot.findFirst({
      where: { email: dto.email, type: 'HUMAN' },
      include: { tenant: { select: { status: true, tenant_type: true } } },
    });

    if (!slot || !slot.password_hash) {
      this.recordFailedAttempt(dto.email);
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    if (slot.tenant.status !== 'active') {
      throw new ForbiddenException('Tu empresa está inactiva. Contacta al administrador.');
    }

    const valid = await bcrypt.compare(dto.password, slot.password_hash);
    if (!valid) {
      this.recordFailedAttempt(dto.email);
      this.audit.log({
        tenantId: slot.tenant_id,
        actorId: slot.id,
        action: AuditAction.AUTH_LOGIN_FAILED,
        resourceType: 'session',
        payload: { email: dto.email, reason: 'wrong_password' },
        ipAddress,
      });
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    this.clearAttempts(dto.email);

    await this.prisma.teamSlot.update({
      where: { id: slot.id },
      data: { status: 'ONLINE' },
    });

    this.audit.log({
      tenantId: slot.tenant_id,
      actorId: slot.id,
      action: AuditAction.AUTH_LOGIN,
      resourceType: 'session',
      resourceId: slot.id,
      ipAddress,
    });

    return this.buildTokens(slot.id, slot.tenant_id, slot.role, slot.type, slot.email!, slot.name, slot.tenant.tenant_type);
  }

  async refresh(token: string) {
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });

      const slot = await this.prisma.teamSlot.findFirst({
        where: { id: payload.sub },
        select: { id: true, tenant_id: true, role: true, type: true, email: true, name: true, tenant: { select: { tenant_type: true } } },
      });

      if (!slot) throw new UnauthorizedException('Sesión inválida');

      return this.buildTokens(slot.id, slot.tenant_id, slot.role, slot.type, slot.email!, slot.name, slot.tenant.tenant_type);
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
  }

  async logout(slotId: string) {
    const slot = await this.prisma.teamSlot.update({
      where: { id: slotId },
      data: { status: 'OFFLINE' },
      select: { tenant_id: true },
    });
    this.audit.log({
      tenantId: slot.tenant_id,
      actorId: slotId,
      action: AuditAction.AUTH_LOGOUT,
      resourceType: 'session',
      resourceId: slotId,
    });
    return { message: 'Sesión cerrada' };
  }

  async me(slotId: string) {
    return this.prisma.teamSlot.findFirst({
      where: { id: slotId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        type: true,
        status: true,
        avatar_url: true,
        avatar_config: true,
        tenant_id: true,
        department: { select: { id: true, name: true, color: true } },
        tenant: { select: { name: true, logo_url: true, primary_color: true } },
      },
    });
  }

  async changePassword(slotId: string, dto: ChangePasswordDto) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: slotId },
      select: { password_hash: true, tenant_id: true },
    });

    if (!slot?.password_hash) throw new UnauthorizedException();

    const valid = await bcrypt.compare(dto.current_password, slot.password_hash);
    if (!valid) throw new UnauthorizedException('Contraseña actual incorrecta');

    const hash = await bcrypt.hash(dto.new_password, SALT_ROUNDS);
    await this.prisma.teamSlot.update({
      where: { id: slotId },
      data: { password_hash: hash },
    });

    this.audit.log({
      tenantId: slot.tenant_id,
      actorId: slotId,
      action: AuditAction.AUTH_PASSWORD_CHANGED,
      resourceType: 'slot',
      resourceId: slotId,
    });

    return { message: 'Contraseña actualizada correctamente' };
  }

  // ─── Helpers internos ────────────────────────────────────────────────────────

  private buildTokens(
    slotId: string,
    tenantId: string,
    role: string,
    type: string,
    email: string,
    name?: string | null,
    tenantType?: string,
  ) {
    const payload = { sub: slotId, tenant_id: tenantId, role, type, email, tenant_type: tenantType ?? 'BRANCH' };

    return {
      access_token: this.jwt.sign(payload, {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      refresh_token: this.jwt.sign(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      }),
      user: { slot_id: slotId, tenant_id: tenantId, role, type, email, name: name ?? null, tenant_type: tenantType ?? 'BRANCH' },
    };
  }

  private checkLockout(email: string) {
    const entry = loginAttempts.get(email);
    if (entry?.lockedUntil && entry.lockedUntil > new Date()) {
      const minutes = Math.ceil((entry.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(
        `Cuenta bloqueada por ${minutes} min. Demasiados intentos fallidos.`,
      );
    }
  }

  private recordFailedAttempt(email: string) {
    const entry = loginAttempts.get(email) ?? { count: 0 };
    entry.count += 1;
    if (entry.count >= MAX_LOGIN_ATTEMPTS) {
      entry.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    }
    loginAttempts.set(email, entry);
  }

  private clearAttempts(email: string) {
    loginAttempts.delete(email);
  }
}
