import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';

export interface JwtPayload {
  sub: string;       // slot_id
  tenant_id: string;
  role: string;      // owner | admin | manager | employee
  type: string;      // HUMAN | AI_AGENT
  email: string;
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
    });
  }

  async validate(payload: JwtPayload) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id: payload.sub, tenant_id: payload.tenant_id },
      select: { id: true, tenant_id: true, role: true, type: true, email: true, status: true },
    });

    if (!slot) throw new UnauthorizedException('Sesión inválida');

    return {
      slot_id: slot.id,
      tenant_id: slot.tenant_id,
      role: slot.role,
      type: slot.type,
      email: slot.email,
    };
  }
}
