import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';

export interface JwtPayload {
  sub: string;
  tenant_id: string;
  role: string;
  type: string;
  email: string;
  platform_admin?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') as string,
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload) {
    // Los platform_admin (superadmin) pueden operar sin restricción de tenant
    const where = payload.platform_admin
      ? { id: payload.sub }
      : { id: payload.sub, tenant_id: payload.tenant_id };

    const slot = await this.prisma.teamSlot.findFirst({
      where,
      select: { id: true, tenant_id: true, role: true, type: true, email: true, status: true },
    });

    if (!slot) throw new UnauthorizedException('Sesión inválida');

    // Platform admins usan X-Tenant-Id para operar en nombre de otro tenant
    let effectiveTenantId = slot.tenant_id;
    if (payload.platform_admin) {
      const header = req.headers['x-tenant-id'];
      if (header && typeof header === 'string') effectiveTenantId = header;
    }

    return {
      slot_id:        slot.id,
      tenant_id:      effectiveTenantId,
      role:           slot.role,
      type:           slot.type,
      email:          slot.email,
      platform_admin: payload.platform_admin ?? false,
    };
  }
}
