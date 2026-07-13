import { Controller, Get, Post, Patch, Delete, Body, Param, Req, Query } from '@nestjs/common';
import { MentoriaService } from './mentoria.service';
import { MentoriaProcesamientoService } from './mentoria-procesamiento.service';

@Controller('mentoria')
export class MentoriaController {
  constructor(
    private readonly service: MentoriaService,
    private readonly procesamiento: MentoriaProcesamientoService,
  ) {}

  // ── DEBUG (borrar después de verificar) ────────────────────────────────────

  @Get('debug/user')
  debugUser(@Req() req: any) {
    return { user: req.user, ts: new Date().toISOString() };
  }

  // ── PROSPECTOS ──────────────────────────────────────────────────────────────

  @Get('prospectos')
  getProspectos(@Req() req: any) {
    return this.service.getProspectos(req.user.tenant_id);
  }

  @Post('prospectos')
  createProspecto(@Req() req: any, @Body() body: any) {
    return this.service.createProspecto(req.user.tenant_id, body);
  }

  @Patch('prospectos/:id/etapa')
  updateEtapa(@Req() req: any, @Param('id') id: string, @Body() body: { etapa: string }) {
    return this.service.updateProspectoEtapa(req.user.tenant_id, id, body.etapa);
  }

  @Patch('prospectos/:id/notas')
  updateProspectoNotas(@Req() req: any, @Param('id') id: string, @Body() body: { notas: string }) {
    return this.service.updateProspectoNotas(req.user.tenant_id, id, body.notas);
  }

  @Post('prospectos/:id/convertir')
  convertirACliente(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.convertirACliente(req.user.tenant_id, id, body);
  }

  // ── WEBHOOK: recibe leads del Agente de Prospección ────────────────────────
  // Este endpoint es público (sin JWT) para que el HTML del agente pueda llamarlo

  @Post('webhook/lead')
  async recibirLead(@Body() body: any) {
    // El agente de prospección envía: { trigger, lead: { nombre, canal, contacto, empresa, answers, hallazgos, roi } }
    const lead = body.lead ?? body;
    // Buscamos el tenant por defecto (MentorIA Systems) o por header
    // Por ahora guardamos con un tenant placeholder que se configura en .env
    const tenantId = process.env.MENTORIA_TENANT_ID ?? 'mentoria-default';

    return this.service.createProspecto(tenantId, {
      empresa: lead.empresa ?? lead.answers?.empresa ?? 'Sin nombre',
      contacto: lead.nombre ?? '',
      canal: lead.canal,
      email: lead.canal === 'email' ? lead.contacto : undefined,
      whatsapp: lead.canal === 'whatsapp' ? lead.contacto : undefined,
      conversacion: lead.answers,
      micro_diagnostico: lead.answers?.dolores,
      hallazgos_preventa: lead.hallazgos,
      roi_estimado: lead.roi,
    });
  }

  // ── CLIENTES ────────────────────────────────────────────────────────────────

  @Get('clientes')
  getClientes(@Req() req: any, @Query('status') status?: string) {
    return this.service.getClientes(req.user.tenant_id, status);
  }

  @Post('clientes')
  createCliente(@Req() req: any, @Body() body: any) {
    return this.service.convertirACliente(req.user.tenant_id, body.prospecto_id, body);
  }

  @Get('clientes/:id')
  getCliente(@Req() req: any, @Param('id') id: string) {
    return this.service.getCliente(req.user.tenant_id, id);
  }

  @Patch('clientes/:id')
  updateCliente(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.updateCliente(req.user.tenant_id, id, body);
  }

  @Patch('clientes/:id/fase')
  updateFase(@Req() req: any, @Param('id') id: string, @Body() body: { fase: number }) {
    return this.service.updateFase(req.user.tenant_id, id, body.fase);
  }

  @Patch('clientes/:id/status')
  updateStatus(@Req() req: any, @Param('id') id: string, @Body() body: { status: string }) {
    return this.service.updateStatus(req.user.tenant_id, id, body.status);
  }

  @Patch('clientes/:id/notas')
  updateNotas(@Req() req: any, @Param('id') id: string, @Body() body: { notas: string }) {
    return this.service.updateCliente(req.user.tenant_id, id, { notas: body.notas });
  }

  @Patch('clientes/:id/areas')
  marcarArea(@Req() req: any, @Param('id') id: string, @Body() body: { area: string }) {
    return this.service.marcarAreaDiagnosticada(req.user.tenant_id, id, body.area);
  }

  // ── CHECKS ─────────────────────────────────────────────────────────────────

  @Post('clientes/:id/checks')
  toggleCheck(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { check_id: string; phase: number; checked: boolean },
  ) {
    return this.service.toggleCheck(req.user.tenant_id, id, body.check_id, body.phase, body.checked);
  }

  // ── HALLAZGOS ───────────────────────────────────────────────────────────────

  @Get('clientes/:id/hallazgos')
  getHallazgos(@Req() req: any, @Param('id') id: string) {
    return this.service.getHallazgos(req.user.tenant_id, id);
  }

  @Post('clientes/:id/hallazgos')
  createHallazgo(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.createHallazgo(req.user.tenant_id, id, body);
  }

  @Delete('clientes/:id/hallazgos/:hid')
  deleteHallazgo(@Req() req: any, @Param('id') id: string, @Param('hid') hid: string) {
    return this.service.deleteHallazgo(req.user.tenant_id, id, hid);
  }

  // ── PLAN DE ACCIÓN ───────────────────────────────────────────────────────────

  @Get('clientes/:id/plan')
  getPlan(@Req() req: any, @Param('id') id: string) {
    return this.service.getPlan(req.user.tenant_id, id);
  }

  @Post('clientes/:id/plan')
  createAccion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.createAccion(req.user.tenant_id, id, body);
  }

  @Patch('clientes/:id/plan/:aid/status')
  updateAccionStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Param('aid') aid: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateAccionStatus(req.user.tenant_id, id, aid, body.status);
  }

  @Delete('clientes/:id/plan/:aid')
  deleteAccion(@Req() req: any, @Param('id') id: string, @Param('aid') aid: string) {
    return this.service.deleteAccion(req.user.tenant_id, id, aid);
  }

  // ── SESIONES ────────────────────────────────────────────────────────────────

  @Get('clientes/:id/sesiones')
  getSesiones(@Req() req: any, @Param('id') id: string) {
    return this.service.getSesiones(req.user.tenant_id, id);
  }

  @Post('clientes/:id/sesiones')
  createSesion(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.createSesion(req.user.tenant_id, id, body);
  }

  // ── PAGOS ────────────────────────────────────────────────────────────────────

  @Get('clientes/:id/pagos')
  getPagos(@Req() req: any, @Param('id') id: string) {
    return this.service.getPagos(req.user.tenant_id, id);
  }

  @Post('clientes/:id/pagos')
  createPago(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.service.createPago(req.user.tenant_id, id, body);
  }

  // ── DIAGNÓSTICOS (datos de formularios HTML) ────────────────────────────────

  @Get('clientes/:id/diagnosticos')
  getDiagnosticos(@Req() req: any, @Param('id') id: string) {
    return this.service.getDiagnosticos(req.user.tenant_id, id);
  }

  @Post('clientes/:id/diagnosticos')
  saveDiagnostico(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { area: string; datos: any },
  ) {
    return this.service.saveDiagnostico(req.user.tenant_id, id, body.area, body.datos);
  }

  // ── PROCESAMIENTO AUTOMÁTICO CON IA ─────────────────────────────────────────

  @Post('clientes/:id/procesar')
  async procesarDiagnostico(@Req() req: any, @Param('id') id: string) {
    return this.procesamiento.procesarDiagnostico(req.user.tenant_id, id);
  }
}
