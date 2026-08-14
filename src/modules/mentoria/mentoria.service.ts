import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvolutionAdapter } from '../../integrations/evolution/evolution.adapter';
import { EmailService } from '../email/email.service';

@Injectable()
export class MentoriaService {
  private readonly logger = new Logger(MentoriaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionAdapter,
    private readonly email: EmailService,
  ) {}

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

  async createClienteDirect(tenantId: string, data: {
    empresa: string; contacto_nombre?: string; contacto_cargo?: string;
    email?: string; whatsapp?: string; industria?: string; tamano?: string;
    ejecutivo_asignado?: string; precio?: number;
  }) {
    // Crea un prospecto en etapa "implementacion" como registro de origen
    const prospecto = await this.prisma.mentoriaProspecto.create({
      data: {
        tenant_id: tenantId,
        empresa: data.empresa,
        contacto: data.contacto_nombre ?? '',
        email: data.email,
        whatsapp: data.whatsapp,
        industria: data.industria,
        tamano: data.tamano,
        ejecutivo_asignado: data.ejecutivo_asignado,
        etapa: 'implementacion',
      },
    });

    return this.prisma.mentoriaCliente.create({
      data: {
        tenant_id: tenantId,
        prospecto_id: prospecto.id,
        empresa: data.empresa,
        contacto_nombre: data.contacto_nombre ?? '',
        contacto_cargo: data.contacto_cargo,
        email: data.email,
        whatsapp: data.whatsapp,
        industria: data.industria,
        tamano: data.tamano,
        ejecutivo_asignado: data.ejecutivo_asignado,
        precio: data.precio ?? 0,
        fase_actual: 0,
      },
    });
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

  async debugAllClientes() {
    return this.prisma.mentoriaCliente.findMany({
      select: { id: true, empresa: true, tenant_id: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 30,
    });
  }

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

  // ── AUTOMATIZACIONES ────────────────────────────────────────────────────────

  async getAutomatizaciones(tenantId: string, clienteId?: string) {
    return this.prisma.mentoriaAutomatizacion.findMany({
      where: {
        tenant_id: tenantId,
        ...(clienteId ? { cliente_id: clienteId } : {}),
      },
      include: { cliente: { select: { id: true, empresa: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  async createAutomatizacion(tenantId: string, data: {
    cliente_id?: string;
    nombre: string;
    area: string;
    descripcion?: string;
    tipo: string;
    trigger?: string;
    accion?: string;
    canal?: string;
    webhook_url?: string;
    config?: any;
  }) {
    return this.prisma.mentoriaAutomatizacion.create({
      data: { tenant_id: tenantId, ...data },
      include: { cliente: { select: { id: true, empresa: true } } },
    });
  }

  async updateAutomatizacion(tenantId: string, id: string, data: Partial<{
    nombre: string; area: string; descripcion: string; tipo: string;
    trigger: string; accion: string; canal: string; webhook_url: string;
    config: any; status: string;
  }>) {
    const auto = await this.prisma.mentoriaAutomatizacion.findFirst({ where: { id, tenant_id: tenantId } });
    if (!auto) throw new Error('Automatización no encontrada');
    return this.prisma.mentoriaAutomatizacion.update({ where: { id }, data });
  }

  async activarAutomatizacion(tenantId: string, id: string) {
    const auto = await this.prisma.mentoriaAutomatizacion.findFirst({
      where: { id, tenant_id: tenantId },
      include: { cliente: { select: { id: true, empresa: true } } },
    });
    if (!auto) throw new Error('Automatización no encontrada');

    if (auto.webhook_url) {
      try {
        await fetch(auto.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'activar',
            automatizacion: { id: auto.id, nombre: auto.nombre, area: auto.area, tipo: auto.tipo, trigger: auto.trigger, accion: auto.accion, canal: auto.canal, config: auto.config },
            cliente: auto.cliente,
          }),
        });
      } catch (e) {
        console.error('[Automatizacion] webhook error:', e);
      }
    }

    return this.prisma.mentoriaAutomatizacion.update({
      where: { id },
      data: { status: 'activa', activada_at: new Date() },
    });
  }

  async pausarAutomatizacion(tenantId: string, id: string) {
    const auto = await this.prisma.mentoriaAutomatizacion.findFirst({ where: { id, tenant_id: tenantId } });
    if (!auto) throw new Error('Automatización no encontrada');
    return this.prisma.mentoriaAutomatizacion.update({ where: { id }, data: { status: 'pausada' } });
  }

  async deleteAutomatizacion(tenantId: string, id: string) {
    const auto = await this.prisma.mentoriaAutomatizacion.findFirst({ where: { id, tenant_id: tenantId } });
    if (!auto) throw new Error('Automatización no encontrada');
    return this.prisma.mentoriaAutomatizacion.delete({ where: { id } });
  }

  // ── CUBO DE INFORMACIÓN ─────────────────────────────────────────────────────

  async updateCubo(tenantId: string, clienteId: string, cubo: Record<string, string>) {
    await this.getCliente(tenantId, clienteId);
    return this.prisma.mentoriaCliente.update({ where: { id: clienteId }, data: { cubo } });
  }

  // ── SESIONES DIAGNÓSTICO (sesiones nombradas con chat propio) ───────────────

  async getSesionesDiag(tenantId: string, clienteId: string) {
    const c = await this.getCliente(tenantId, clienteId);
    return ((c as any).sesiones_diagnostico ?? []) as any[];
  }

  async createSesionDiag(tenantId: string, clienteId: string, data: {
    id: string; titulo: string; tipo: string;
    interlocutor: string; cargo: string; area: string; fecha: string;
  }) {
    const c = await this.getCliente(tenantId, clienteId);
    const sesiones: any[] = ((c as any).sesiones_diagnostico ?? []);
    const nueva = { ...data, mensajes: [], cuestionarios_generados: [] };
    await this.prisma.mentoriaCliente.update({
      where: { id: clienteId },
      data: { sesiones_diagnostico: [...sesiones, nueva] as any },
    });
    return nueva;
  }

  async appendSesionDiagMessages(clienteId: string, sesionId: string, entries: { role: string; content: string; ts: string }[]) {
    const c = await this.prisma.mentoriaCliente.findUnique({
      where: { id: clienteId },
      select: { sesiones_diagnostico: true },
    });
    const sesiones: any[] = ((c?.sesiones_diagnostico ?? []) as any[]);
    const idx = sesiones.findIndex((s: any) => s.id === sesionId);
    if (idx === -1) return;
    sesiones[idx].mensajes = [...(sesiones[idx].mensajes ?? []), ...entries];
    await this.prisma.mentoriaCliente.update({
      where: { id: clienteId },
      data: { sesiones_diagnostico: sesiones as any },
    });
  }

  async saveCuestionarioGenerado(clienteId: string, sesionId: string, cuestionario: any) {
    const c = await this.prisma.mentoriaCliente.findUnique({
      where: { id: clienteId },
      select: { sesiones_diagnostico: true },
    });
    const sesiones: any[] = ((c?.sesiones_diagnostico ?? []) as any[]);
    const idx = sesiones.findIndex((s: any) => s.id === sesionId);
    if (idx === -1) return;
    sesiones[idx].cuestionarios_generados = [...(sesiones[idx].cuestionarios_generados ?? []), cuestionario];
    await this.prisma.mentoriaCliente.update({
      where: { id: clienteId },
      data: { sesiones_diagnostico: sesiones as any },
    });
  }

  async saveCuestionarioGlobal(clienteId: string, cuestionario: any) {
    const c = await this.prisma.mentoriaCliente.findUnique({
      where: { id: clienteId },
      select: { cubo: true },
    });
    const cubo = ((c?.cubo ?? {}) as any);
    const cuestionariosGlobales = [...(cubo.__cuestionarios_globales ?? []), cuestionario];
    await this.prisma.mentoriaCliente.update({
      where: { id: clienteId },
      data: { cubo: { ...cubo, __cuestionarios_globales: cuestionariosGlobales } as any },
    });
  }

  async saveDiagnosticoPublic(clienteId: string, area: string, datos: any) {
    const cliente = await this.prisma.mentoriaCliente.findUnique({ where: { id: clienteId } });

    if (cliente) {
      try {
        const existing = await this.prisma.mentoriaDiagnostico.findFirst({ where: { cliente_id: clienteId, area } });
        if (existing) {
          await this.prisma.mentoriaDiagnostico.update({ where: { id: existing.id }, data: { datos, procesado: false } });
        } else {
          await this.prisma.mentoriaDiagnostico.create({ data: { cliente_id: clienteId, area, datos } });
        }
        const cuboActual = (cliente.cubo as Record<string, string>) ?? {};
        const cuboNuevo = this.mergeCuboSection(area, datos, cuboActual, cliente.empresa);
        await this.prisma.mentoriaCliente.update({ where: { id: clienteId }, data: { cubo: cuboNuevo } });
      } catch (e) {
        this.logger.warn(`saveDiagnosticoPublic error para ${clienteId}: ${(e as any)?.message}`);
      }
    } else {
      this.logger.warn(`saveDiagnosticoPublic: clienteId ${clienteId} no encontrado, datos descartados`);
    }

    return { ok: true };
  }

  private mergeCuboSection(area: string, datos: any, cubo: Record<string, string>, empresa: string): Record<string, string> {
    const next = { ...cubo };

    if (area === 'dg') {
      const sistemas = Array.isArray(datos.sistemas) ? datos.sistemas.join(', ') : (datos.sistemas ?? '');
      const directivos = Array.isArray(datos.directivos)
        ? datos.directivos.map((d: any) => `  • ${d.nombre ?? ''} — ${d.cargo ?? ''} (${d.contacto ?? ''})`).join('\n')
        : '';
      next['contexto'] = [
        `Empresa: ${empresa}`,
        `Giro: ${datos.dg?.giro ?? ''}`,
        `Fecha sesión: ${datos.fecha ?? ''}`,
        `Director General: ${datos.dg?.nombre ?? ''}`,
        `Ejecutivo MentorIA: ${datos.dg?.ejecutivo_mentoria ?? ''}`,
        '',
        `Sistemas IT: ${sistemas}`,
        '',
        `Objetivos (12 meses):\n${datos.objetivos ?? ''}`,
        '',
        `Principales retos:\n${datos.retos ?? ''}`,
        '',
        `KPIs actuales:\n${datos.kpis ?? ''}`,
        '',
        `Resultado esperado:\n${datos.resultado ?? ''}`,
        '',
        `Resistencias al cambio:\n${datos.resistencia ?? ''}`,
        '',
        `Quick wins identificados:\n${datos.quickwins ?? ''}`,
        directivos ? `\nDirectivos:\n${directivos}` : '',
      ].filter(Boolean).join('\n').trim();
    }

    else if (area.startsWith('gerente')) {
      const seccion = datos.seccion ?? {};
      const procesos: any[] = Array.isArray(datos.procesos) ? datos.procesos : [];
      const flujos = datos.flujos ?? {};

      const procesosText = procesos.map((p: any) =>
        `  • ${p.nombre ?? ''}: ${p.ejecutor ?? ''}, ${p.frecuencia ?? ''}, ` +
        `Sistema: ${p.sistema ?? ''}, Tiempo: ${p.tiempo ?? ''}` +
        (p.sop === 'si' ? ' [SOP ✓]' : ' [Sin SOP]')
      ).join('\n');

      const recibeText = Array.isArray(flujos.recibe_de)
        ? flujos.recibe_de.map((f: any) => `  ← ${f[0] ?? ''}: ${f[1] ?? ''}`).join('\n') : '';
      const enviaText = Array.isArray(flujos.envia_a)
        ? flujos.envia_a.map((f: any) => `  → ${f[0] ?? ''}: ${f[1] ?? ''}`).join('\n') : '';

      const bloqueArea = [
        `${(seccion.area_label ?? area).toUpperCase()} — ${seccion.gerente ?? ''}`,
        `Personas a cargo: ${seccion.nprs ?? 0}`,
        seccion.roles ? `Roles: ${seccion.roles}` : '',
        seccion.sistemas?.length ? `Sistemas: ${(seccion.sistemas as string[]).join(', ')}` : '',
        procesos.length ? `\nProcesos:\n${procesosText}` : '',
        datos.cuellos ? `\nCuellos de botella:\n${datos.cuellos}` : '',
        datos.errores ? `\nErrores frecuentes:\n${datos.errores}` : '',
        recibeText ? `\nRecibe de:\n${recibeText}` : '',
        enviaText ? `\nEnvía a:\n${enviaText}` : '',
      ].filter(Boolean).join('\n');

      next['areas_procesos'] = ((next['areas_procesos'] ?? '') + '\n\n' + bloqueArea).trim();

      const orgBloque = [
        `${(seccion.area_label ?? area).toUpperCase()} — ${seccion.gerente ?? ''} (${seccion.nivel ?? ''})`,
        `  ${seccion.nprs ?? 0} personas a cargo`,
        seccion.roles ? `  Roles: ${seccion.roles}` : '',
        `  ⚠️ Pendiente: confirmar sueldos con RRHH`,
      ].filter(Boolean).join('\n');

      next['organigrama'] = ((next['organigrama'] ?? '') + '\n\n' + orgBloque).trim();
    }

    else if (area.startsWith('operador')) {
      const seccion = datos.seccion ?? datos.puesto ?? {};
      const docs: any[] = Array.isArray(datos.documentos) ? datos.documentos : [];
      const docsText = docs.map((d: any) =>
        `  • ${d.nombre ?? ''} (${d.tipo ?? ''}) — creado por: ${d.creador ?? ''}`
      ).join('\n');

      const bloqueOrg = [
        `${(seccion.area_label ?? area).toUpperCase()} — ${seccion.puesto ?? ''}`,
        seccion.sub_depto ? `  Sub-depto: ${seccion.sub_depto}` : '',
        datos.actividades_dia ? `  Actividades: ${datos.actividades_dia}` : '',
        datos.herramientas ? `  Herramientas: ${datos.herramientas}` : '',
        `  ⚠️ Pendiente: sueldo`,
      ].filter(Boolean).join('\n');

      next['organigrama'] = ((next['organigrama'] ?? '') + '\n' + bloqueOrg).trim();

      if (docs.length) {
        next['sistemas'] = ((next['sistemas'] ?? '') + `\n\nDOCUMENTOS — ${seccion.area_label ?? area}\n${docsText}`).trim();
      }
    }

    return next;
  }

  // ── ENVÍO DE CUESTIONARIOS ──────────────────────────────────────────────────

  async enviarCuestionario(tenantId: string, clienteId: string, opts: {
    nombre: string;
    cargo?: string;
    whatsapp?: string;
    email?: string;
    tipo: 'gerente' | 'operador';
    instanceName?: string;
    empresa?: string;
  }) {
    let empresaNombre = opts.empresa ?? '';
    try {
      const cliente = await this.getCliente(tenantId, clienteId);
      empresaNombre = cliente.empresa;
    } catch {
      if (!empresaNombre) throw new NotFoundException('Cliente no encontrado y no se proporcionó empresa');
    }
    const archivo = opts.tipo === 'gerente' ? 'cuestionario-gerente.html' : 'cuestionario-operador.html';
    const url = `https://flowdesk.mx/flowdesk/diagnosticos/${archivo}?clienteId=${clienteId}&empresa=${encodeURIComponent(empresaNombre)}`;

    const mensaje = `Hola ${opts.nombre}, te escribimos de MentorIA Systems.\n\nEstamos realizando el diagnóstico operativo de ${empresaNombre} y necesitamos tu participación.\n\nPor favor completa el siguiente cuestionario (toma ~10 min):\n${url}\n\nGracias 🙏`;

    let wa_enviado = false;
    let wa_error: string | null = null;
    let email_enviado = false;

    if (opts.whatsapp) {
      let instanceName = opts.instanceName;
      if (!instanceName) {
        const cfg = await this.prisma.secretaryConfig.findUnique({
          where: { tenant_id: tenantId },
          select: { evolution_instance: true },
        });
        instanceName = cfg?.evolution_instance ?? undefined;
      }
      if (instanceName) {
        try {
          await this.evolution.sendText(instanceName, opts.whatsapp, mensaje);
          wa_enviado = true;
          this.logger.log(`Cuestionario enviado por WhatsApp a ${opts.whatsapp}`);
        } catch (e) {
          wa_error = (e as any)?.message ?? 'Error al enviar WhatsApp';
          this.logger.warn(`Error WhatsApp a ${opts.whatsapp}: ${wa_error}`);
        }
      } else {
        wa_error = 'Sin instancia WhatsApp configurada para este tenant';
        this.logger.warn(`enviarCuestionario: sin instancia Evolution para tenant ${tenantId}`);
      }
    }

    if (opts.email) {
      try {
        await this.email.sendCuestionario({
          to: opts.email,
          nombre: opts.nombre,
          empresa: empresaNombre,
          tipo: opts.tipo,
          url,
        });
        email_enviado = true;
      } catch (e) {
        this.logger.warn(`Error email a ${opts.email}: ${(e as any)?.message}`);
      }
    }

    return { ok: true, url, mensaje, wa_enviado, wa_error, email_enviado };
  }
}
