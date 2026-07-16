import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class MentoriaService {
  constructor(private readonly prisma: PrismaService) {}

  // ── PROSPECTOS ──────────────────────────────────────────────────────────────

  async getProspectos(tenantId: string) {
    return this.prisma.mentoriaProspecto.findMany({
      where: { tenant_id: tenantId, status: 'activo', etapa: { not: 'implementacion' } },
      orderBy: { created_at: 'desc' },
      include: { cliente: { select: { id: true, fase_actual: true, status: true } } },
    });
  }

  async getDescartados(tenantId: string) {
    return this.prisma.mentoriaProspecto.findMany({
      where: { tenant_id: tenantId, status: 'descartado' },
      orderBy: { updated_at: 'desc' },
    });
  }

  async descartarProspecto(tenantId: string, id: string) {
    await this.findProspecto(tenantId, id);
    return this.prisma.mentoriaProspecto.update({
      where: { id },
      data: { status: 'descartado', fecha_ultima_accion: new Date() },
    });
  }

  async reactivarProspecto(tenantId: string, id: string) {
    return this.prisma.mentoriaProspecto.update({
      where: { id },
      data: { status: 'activo', fecha_ultima_accion: new Date() },
    });
  }

  async createProspecto(tenantId: string, data: {
    empresa: string; contacto: string; email?: string; whatsapp?: string;
    industria?: string; tamano?: string; canal?: string;
    conversacion?: any; micro_diagnostico?: string; hallazgos_preventa?: any;
    roi_estimado?: string; ejecutivo_asignado?: string;
  }) {
    return this.prisma.mentoriaProspecto.create({
      data: { tenant_id: tenantId, ...data },
    });
  }

  async updateProspectoEtapa(tenantId: string, id: string, etapa: string) {
    await this.findProspecto(tenantId, id);
    return this.prisma.mentoriaProspecto.update({
      where: { id },
      data: { etapa, fecha_ultima_accion: new Date() },
    });
  }

  async updateProspectoNotas(tenantId: string, id: string, notas: string) {
    await this.findProspecto(tenantId, id);
    return this.prisma.mentoriaProspecto.update({ where: { id }, data: { notas } });
  }

  async convertirACliente(tenantId: string, prospecto_id: string, datos: {
    precio?: number; ejecutivo_asignado?: string; drive_url?: string;
  }) {
    const prospecto = await this.findProspecto(tenantId, prospecto_id);
    const cliente = await this.prisma.mentoriaCliente.create({
      data: {
        tenant_id: tenantId,
        prospecto_id,
        empresa: prospecto.empresa,
        contacto_nombre: prospecto.contacto,
        email: prospecto.email,
        whatsapp: prospecto.whatsapp,
        industria: prospecto.industria,
        tamano: prospecto.tamano,
        ejecutivo_asignado: datos.ejecutivo_asignado ?? prospecto.ejecutivo_asignado,
        precio: datos.precio ?? 0,
        drive_url: datos.drive_url,
        fase_actual: 0,
      },
    });
    await this.prisma.mentoriaProspecto.update({
      where: { id: prospecto_id },
      data: { etapa: 'implementacion', fecha_ultima_accion: new Date() },
    });
    return cliente;
  }

  private async findProspecto(tenantId: string, id: string) {
    const p = await this.prisma.mentoriaProspecto.findFirst({ where: { id, tenant_id: tenantId } });
    if (!p) throw new NotFoundException('Prospecto no encontrado');
    return p;
  }

  // ── CLIENTES ────────────────────────────────────────────────────────────────

  async getClientes(tenantId: string, status?: string) {
    return this.prisma.mentoriaCliente.findMany({
      where: { tenant_id: tenantId, ...(status ? { status } : {}) },
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { hallazgos: true, plan: true, sesiones: true } },
      },
    });
  }

  async getCliente(tenantId: string, id: string) {
    const c = await this.prisma.mentoriaCliente.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        hallazgos: { orderBy: { created_at: 'desc' } },
        plan: { orderBy: { created_at: 'desc' } },
        sesiones: { orderBy: { fecha: 'desc' } },
        pagos: { orderBy: { fecha: 'desc' } },
        checks: true,
        diagnosticos: { orderBy: { created_at: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    return c;
  }

  async updateCliente(tenantId: string, id: string, data: Partial<{
    empresa: string; contacto_nombre: string; contacto_cargo: string;
    email: string; whatsapp: string; industria: string; tamano: string;
    ejecutivo_asignado: string; drive_url: string; precio: number;
    notas: string; fecha_fin: string;
  }>) {
    await this.getCliente(tenantId, id);
    return this.prisma.mentoriaCliente.update({ where: { id }, data });
  }

  async updateFase(tenantId: string, id: string, fase: number) {
    await this.getCliente(tenantId, id);
    return this.prisma.mentoriaCliente.update({ where: { id }, data: { fase_actual: fase } });
  }

  async updateStatus(tenantId: string, id: string, status: string) {
    await this.getCliente(tenantId, id);
    return this.prisma.mentoriaCliente.update({ where: { id }, data: { status } });
  }

  async marcarAreaDiagnosticada(tenantId: string, id: string, area: string) {
    const cliente = await this.getCliente(tenantId, id);
    const areas = [...new Set([...cliente.areas_diagnosticadas, area])];
    return this.prisma.mentoriaCliente.update({ where: { id }, data: { areas_diagnosticadas: areas } });
  }

  // ── CHECKS (checklist por fase) ─────────────────────────────────────────────

  async toggleCheck(tenantId: string, clienteId: string, checkId: string, phase: number, checked: boolean) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaCheck.upsert({
      where: { cliente_id_check_id: { cliente_id: clienteId, check_id: checkId } },
      create: { cliente_id: clienteId, check_id: checkId, phase, checked, checked_at: checked ? new Date() : null },
      update: { checked, checked_at: checked ? new Date() : null },
    });
  }

  // ── HALLAZGOS ───────────────────────────────────────────────────────────────

  async getHallazgos(tenantId: string, clienteId: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaHallazgo.findMany({
      where: { cliente_id: clienteId },
      orderBy: [{ tipo: 'asc' }, { created_at: 'desc' }],
    });
  }

  async createHallazgo(tenantId: string, clienteId: string, data: {
    area?: string; tipo?: string; titulo: string; descripcion?: string; impacto?: string;
  }) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaHallazgo.create({
      data: {
        cliente_id: clienteId,
        area: data.area ?? 'general',
        tipo: data.tipo ?? 'importante',
        titulo: data.titulo,
        descripcion: data.descripcion,
        impacto: data.impacto,
      },
    });
  }

  async deleteHallazgo(tenantId: string, clienteId: string, id: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaHallazgo.delete({ where: { id } });
  }

  // ── PLAN DE ACCIÓN ───────────────────────────────────────────────────────────

  async getPlan(tenantId: string, clienteId: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaAccionPlan.findMany({
      where: { cliente_id: clienteId },
      orderBy: [{ prioridad: 'asc' }, { created_at: 'desc' }],
      include: { hallazgo: { select: { titulo: true, tipo: true } } },
    });
  }

  async createAccion(tenantId: string, clienteId: string, data: {
    titulo: string; area: string; prioridad?: string; responsable?: string;
    fecha_estimada?: string; hallazgo_id?: string; notas?: string;
  }) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaAccionPlan.create({
      data: {
        cliente_id: clienteId,
        titulo: data.titulo,
        area: data.area,
        prioridad: data.prioridad ?? 'alta',
        responsable: data.responsable,
        fecha_estimada: data.fecha_estimada ? new Date(data.fecha_estimada) : undefined,
        hallazgo_id: data.hallazgo_id || undefined,
        notas: data.notas,
      },
    });
  }

  async updateAccionStatus(tenantId: string, clienteId: string, id: string, status: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaAccionPlan.update({ where: { id }, data: { status } });
  }

  async deleteAccion(tenantId: string, clienteId: string, id: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaAccionPlan.delete({ where: { id } });
  }

  // ── SESIONES ────────────────────────────────────────────────────────────────

  async getSesiones(tenantId: string, clienteId: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaSesion.findMany({
      where: { cliente_id: clienteId },
      orderBy: { fecha: 'desc' },
    });
  }

  async createSesion(tenantId: string, clienteId: string, data: {
    fecha: string; tipo: string; titulo: string; notas?: string; acciones?: string;
  }) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaSesion.create({
      data: { cliente_id: clienteId, ...data, fecha: new Date(data.fecha) },
    });
  }

  // ── PAGOS ────────────────────────────────────────────────────────────────────

  async getPagos(tenantId: string, clienteId: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaPago.findMany({
      where: { cliente_id: clienteId },
      orderBy: { fecha: 'desc' },
    });
  }

  async createPago(tenantId: string, clienteId: string, data: {
    fecha: string; monto: number; concepto: string; status?: string;
  }) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaPago.create({
      data: { cliente_id: clienteId, ...data, fecha: new Date(data.fecha) },
    });
  }

  // ── DIAGNÓSTICOS (datos de formularios) ────────────────────────────────────

  async saveDiagnostico(tenantId: string, clienteId: string, area: string, datos: any) {
    await this.getCliente(tenantId, clienteId);
    const existing = await this.prisma.mentoriaDiagnostico.findFirst({
      where: { cliente_id: clienteId, area },
    });
    if (existing) {
      return this.prisma.mentoriaDiagnostico.update({
        where: { id: existing.id },
        data: { datos, procesado: false },
      });
    }
    return this.prisma.mentoriaDiagnostico.create({
      data: { cliente_id: clienteId, area, datos },
    });
  }

  async getDiagnosticos(tenantId: string, clienteId: string) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaDiagnostico.findMany({
      where: { cliente_id: clienteId },
      orderBy: { created_at: 'desc' },
    });
  }

  async getAllDiagnosticoData(clienteId: string) {
    return this.prisma.mentoriaDiagnostico.findMany({
      where: { cliente_id: clienteId },
      select: { area: true, datos: true },
    });
  }

  async markDiagnosticoProcesado(clienteId: string) {
    await this.prisma.mentoriaDiagnostico.updateMany({
      where: { cliente_id: clienteId },
      data: { procesado: true },
    });
  }
}
