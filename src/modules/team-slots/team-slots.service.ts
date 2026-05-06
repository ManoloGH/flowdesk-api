import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../database/prisma.service';
import { CreateHumanSlotDto, CreateAgentSlotDto } from './dto/create-slot.dto';
import { UpdateSlotDto, UpdateStatusDto } from './dto/update-slot.dto';

const SALT_ROUNDS = 12;

const SLOT_SELECT = {
  id: true,
  name: true,
  type: true,
  role: true,
  email: true,
  status: true,
  avatar_url: true,
  avatar_config: true,
  position_x: true,
  position_y: true,
  permissions: true,
  agent_config: true,
  created_at: true,
  department: { select: { id: true, name: true, color: true, icon: true } },
  schedule: { select: { id: true, name: true, check_in_time: true, check_out_time: true } },
};

@Injectable()
export class TeamSlotsService {
  constructor(private prisma: PrismaService) {}

  // Listar todos los slots de la empresa (con filtros opcionales)
  async findAll(tenantId: string, filters?: { type?: string; department_id?: string; status?: string }) {
    return this.prisma.teamSlot.findMany({
      where: {
        tenant_id: tenantId,
        ...(filters?.type && { type: filters.type as any }),
        ...(filters?.department_id && { department_id: filters.department_id }),
        ...(filters?.status && { status: filters.status as any }),
      },
      select: SLOT_SELECT,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string, tenantId: string) {
    const slot = await this.prisma.teamSlot.findFirst({
      where: { id, tenant_id: tenantId },
      select: SLOT_SELECT,
    });
    if (!slot) throw new NotFoundException('Colaborador no encontrado');
    return slot;
  }

  // Agente CEO personal del usuario, con fallbacks
  async myAgent(humanSlotId: string, tenantId: string) {
    // Preferir CEO agent
    const ceo = await this.prisma.teamSlot.findFirst({
      where: { owner_slot_id: humanSlotId, tenant_id: tenantId, type: 'AI_AGENT', agent_role: 'ceo' },
      select: { ...SLOT_SELECT, agent_role: true },
    });
    if (ceo) return ceo;

    // Fallback: cualquier agente personal
    const personal = await this.prisma.teamSlot.findFirst({
      where: { owner_slot_id: humanSlotId, tenant_id: tenantId, type: 'AI_AGENT' },
      select: { ...SLOT_SELECT, agent_role: true },
    });
    if (personal) return personal;

    // Último recurso: primer agente del tenant
    return this.prisma.teamSlot.findFirst({
      where: { tenant_id: tenantId, type: 'AI_AGENT' },
      select: { ...SLOT_SELECT, agent_role: true },
    });
  }

  // Crear o renombrar el CEO Agent de un usuario
  async ensureCeoAgent(humanSlotId: string, tenantId: string, agentName: string, humanName: string) {
    const instructions =
      `Eres ${agentName}, el CEO Agent de ${humanName} en FlowDesk. ` +
      `Tu misión: garantizar que ${humanName} cumpla todos sus objetivos personales y empresariales. ` +
      `Eres su socio estratégico — proactivo, directo y orientado a resultados. ` +
      `Responsabilidades clave: ` +
      `(1) Revisar y priorizar tareas diariamente. ` +
      `(2) Detectar cuellos de botella y proponer soluciones concretas. ` +
      `(3) Coordinar con otros agentes del equipo para distribuir trabajo. ` +
      `(4) Proponer la creación de nuevos agentes cuando detectes una brecha. ` +
      `(5) Mantener todos los elementos del Desk en su estado óptimo. ` +
      `(6) Dar seguimiento a metas y alertar cuando haya riesgo de no cumplirlas. ` +
      `Tono: ejecutivo, conciso, motivador. Máximo 3 párrafos por respuesta salvo que se pida más detalle.`;

    const existing = await this.prisma.teamSlot.findFirst({
      where: { owner_slot_id: humanSlotId, tenant_id: tenantId, agent_role: 'ceo' },
    });

    if (existing) {
      return this.prisma.teamSlot.update({
        where: { id: existing.id },
        data: { name: agentName, agent_config: { ...(existing.agent_config as any), instructions } },
      });
    }

    return this.prisma.teamSlot.create({
      data: {
        tenant_id: tenantId,
        name: agentName,
        type: 'AI_AGENT',
        role: 'employee',
        status: 'ONLINE',
        agent_scope: 'personal',
        agent_role: 'ceo',
        owner_slot_id: humanSlotId,
        agent_config: {
          model: 'claude-sonnet-4-6',
          instructions,
          tools: [],
        },
      },
    });
  }

  // Crear humano — genera contraseña temporal que el admin comparte con el empleado
  async createHuman(tenantId: string, dto: CreateHumanSlotDto) {
    const exists = await this.prisma.teamSlot.findFirst({ where: { email: dto.email } });
    if (exists) throw new ConflictException(`El email ${dto.email} ya está registrado`);

    const tempPassword = this.generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);

    const slot = await this.prisma.teamSlot.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        email: dto.email,
        password_hash: hash,
        role: dto.role ?? 'employee',
        type: 'HUMAN',
        department_id: dto.department_id,
        schedule_id: dto.schedule_id,
      },
      select: SLOT_SELECT,
    });

    // La contraseña temporal solo se devuelve aquí, nunca más se puede recuperar
    return { slot, temp_password: tempPassword, message: 'Comparte esta contraseña con el empleado. Solo se muestra una vez.' };
  }

  // Crear agente IA
  async createAgent(tenantId: string, dto: CreateAgentSlotDto) {
    return this.prisma.teamSlot.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        type: 'AI_AGENT',
        role: 'employee',
        department_id: dto.department_id,
        agent_config: dto.agent_config,
        status: 'ONLINE', // Los agentes siempre están online
      },
      select: SLOT_SELECT,
    });
  }

  async update(id: string, tenantId: string, dto: UpdateSlotDto, requestingRole: string, requestingSlotId: string) {
    const slot = await this.findOne(id, tenantId);

    const isSelf = id === requestingSlotId;
    const isManager = ['owner', 'admin', 'manager'].includes(requestingRole);

    if (!isSelf && !isManager) throw new ForbiddenException('Solo puedes editar tu propio perfil');
    if (isSelf && !isManager && (dto.role || dto.department_id)) throw new ForbiddenException('No puedes cambiar tu rol o departamento');

    // agent_name no es un campo del modelo — lo extraemos antes de pasar a Prisma
    const { agent_name, ...profileData } = dto;

    const updated = await this.prisma.teamSlot.update({
      where: { id },
      data: profileData as any,
      select: SLOT_SELECT,
    });

    // Crear/actualizar CEO Agent si se proporcionó nombre
    if (agent_name && isSelf) {
      await this.ensureCeoAgent(id, tenantId, agent_name, (updated as any).name ?? slot.name);
    }

    return updated;
  }

  // El empleado actualiza su propio status (online, busy, away)
  async updateStatus(id: string, tenantId: string, dto: UpdateStatusDto) {
    await this.findOne(id, tenantId);
    return this.prisma.teamSlot.update({
      where: { id },
      data: { status: dto.status as any },
      select: { id: true, name: true, status: true },
    });
  }

  async remove(id: string, tenantId: string) {
    const slot = await this.findOne(id, tenantId);
    await this.prisma.teamSlot.delete({ where: { id } });
    return { message: `${slot.name} eliminado del equipo` };
  }

  // Vista del mapa de oficina — posiciones de todos los slots online
  async officeMap(tenantId: string) {
    return this.prisma.teamSlot.findMany({
      where: { tenant_id: tenantId },
      select: {
        id: true,
        name: true,
        type: true,
        role: true,
        status: true,
        avatar_url: true,
        avatar_config: true,
        position_x: true,
        position_y: true,
        department: { select: { id: true, name: true, color: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private generateTempPassword(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@$!';
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}
