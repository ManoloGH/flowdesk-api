import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiProviderService } from '../../ai/ai-provider.service';
import { CreateRequirementDto, UpdateRequirementDto, UpdateRequirementStatusDto, GenerateRequirementDocDto } from './dto/requirement.dto';

@Injectable()
export class RequirementsService {
  constructor(
    private prisma: PrismaService,
    private aiProvider: AiProviderService,
  ) {}

  async findAll(tenantId: string, filters?: { status?: string; doc_type?: string }) {
    return this.prisma.requirement.findMany({
      where: {
        tenant_id: tenantId,
        ...(filters?.status ? { status: filters.status as any } : {}),
        ...(filters?.doc_type ? { doc_type: filters.doc_type as any } : {}),
      },
      include: {
        pm_slot: { select: { id: true, name: true, avatar_url: true } },
        _count: { select: { history: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const req = await this.prisma.requirement.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        pm_slot: { select: { id: true, name: true, avatar_url: true } },
        excel_upload: true,
        history: {
          include: { slot: { select: { id: true, name: true } } },
          orderBy: { created_at: 'desc' },
          take: 20,
        },
        sisec_items: true,
      },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado');
    return req;
  }

  async create(tenantId: string, slotId: string | null, dto: CreateRequirementDto) {
    const folio = await this.generateFolio(tenantId);
    const req = await this.prisma.requirement.create({
      data: {
        folio,
        tenant_id: tenantId,
        title: dto.title,
        doc_type: dto.doc_type ?? 'MEJORA',
        intake_source: dto.intake_source ?? 'FORMULARIO',
        pm_slot_id: dto.pm_slot_id,
        current_situation: dto.current_situation,
        problem_statement: dto.problem_statement,
        objective: dto.objective,
        business_policies: dto.business_policies,
        related_systems: dto.related_systems,
        committed_dates: dto.committed_dates,
        scope: dto.scope,
        out_of_scope: dto.out_of_scope,
        assumptions: dto.assumptions,
        constraints: dto.constraints,
        requested_by: dto.requested_by,
        requested_by_email: dto.requested_by_email,
        responsible_systems: dto.responsible_systems,
        responsible_business: dto.responsible_business,
        estimated_effort_days: dto.estimated_effort_days,
        estimated_duration: dto.estimated_duration,
        start_date: dto.start_date ? new Date(dto.start_date) : undefined,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
        excel_upload_id: dto.excel_upload_id,
      },
    });

    if (slotId) await this.recordHistory(req.id, slotId, 'created', null, 'BORRADOR');
    return req;
  }

  async createFromIntake(tenantId: string, slotId: string | null, uploadId: string) {
    // Idempotente: si ya existe un requirement para este upload, devolverlo
    const existing = await this.prisma.requirement.findFirst({
      where: { excel_upload_id: uploadId },
      select: { id: true, folio: true },
    });
    if (existing) return existing;

    const upload = await this.prisma.excelUpload.findFirst({
      where: { id: uploadId, tenant_id: tenantId },
      include: { questionnaire: true },
    });
    if (!upload) throw new NotFoundException('Upload de intake no encontrado');

    const raw = upload.raw_content ?? '';
    const parseField = (label: string): string => {
      const m = raw.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
      return m?.[1]?.trim() ?? '';
    };

    const solicitante = parseField('Solicitante') || upload.area_name;
    const areaSol    = parseField('Área');
    const tipo       = parseField('Tipo de desarrollo');
    const docType    = tipo.includes('Modificación') ? 'MEJORA' : 'NUEVO_DESARROLLO';

    const descMatch  = raw.match(/=== Descripción del proceso ===([\s\S]*?)(?:=== Datos del Excel ===|$)/);
    const descripcion = descMatch?.[1]?.trim() ?? '';

    const year = new Date().getFullYear();
    const title = `${upload.area_name} — ${tipo || 'Requerimiento de sistema'} ${year}`;

    return this.create(tenantId, slotId, {
      title,
      doc_type: docType as any,
      requested_by: solicitante,
      requested_by_email: upload.area_email ?? undefined,
      responsible_business: areaSol || upload.area_name,
      current_situation: descripcion,
      intake_source: 'EXCEL_AREA' as any,
      excel_upload_id: uploadId,
    });
  }

  async update(tenantId: string, slotId: string, id: string, dto: UpdateRequirementDto) {
    await this.assertAccess(tenantId, id);
    const req = await this.prisma.requirement.update({
      where: { id },
      data: {
        title: dto.title,
        doc_type: dto.doc_type as any,
        pm_slot_id: dto.pm_slot_id,
        current_situation: dto.current_situation,
        problem_statement: dto.problem_statement,
        objective: dto.objective,
        business_policies: dto.business_policies,
        related_systems: dto.related_systems,
        committed_dates: dto.committed_dates,
        scope: dto.scope,
        out_of_scope: dto.out_of_scope,
        assumptions: dto.assumptions,
        constraints: dto.constraints,
        requested_by: dto.requested_by,
        requested_by_email: dto.requested_by_email,
        responsible_systems: dto.responsible_systems,
        responsible_business: dto.responsible_business,
        estimated_effort_days: dto.estimated_effort_days,
        estimated_duration: dto.estimated_duration,
        start_date: dto.start_date ? new Date(dto.start_date) : undefined,
        due_date: dto.due_date ? new Date(dto.due_date) : undefined,
      },
    });

    await this.recordHistory(id, slotId, 'edited');
    return req;
  }

  async updateStatus(tenantId: string, slotId: string, id: string, dto: UpdateRequirementStatusDto) {
    const req = await this.assertAccess(tenantId, id);
    const updated = await this.prisma.requirement.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.recordHistory(id, slotId, 'status_changed', req.status, dto.status, dto.notes);
    return updated;
  }

  async generateDocument(tenantId: string, slotId: string, id: string, dto: GenerateRequirementDocDto) {
    const req = await this.assertAccess(tenantId, id);

    // Contexto del Excel si está vinculado
    let excelData: any = null;
    let excelContext = '';
    if (req.excel_upload_id) {
      excelData = await this.prisma.excelUpload.findUnique({
        where: { id: req.excel_upload_id },
        include: { questionnaire: true },
      });
      if (excelData) {
        const colMap = excelData.column_map ?? {};
        const answers = excelData.questionnaire?.area_answers ?? {};
        excelContext = `\n\nEXCEL DEL ÁREA:
Área: ${excelData.area_name}
Columnas clasificadas:
${Object.entries(colMap).map(([k, v]) => `  ${k}: ${v}`).join('\n')}
Respuestas del área:
${Object.entries(answers).map(([k, v]) => `  ${k}: ${v}`).join('\n') || '  (sin respuestas aún)'}
Notas del análisis: ${excelData.analysis_notes?.slice(0, 600) ?? '(ninguna)'}`;
      }
    }

    let rulesContext = '';
    if (dto.include_rules !== false) {
      const rules = await this.prisma.businessRule.findMany({
        where: { tenant_id: tenantId, is_active: true },
        select: { name: true, description: true, category: true },
        take: 30,
      });
      if (rules.length) {
        rulesContext = `\n\nREGLAS DE NEGOCIO ACTIVAS:\n${rules.map((r) => `- [${r.category}] ${r.name}: ${r.description}`).join('\n')}`;
      }
    }

    const systemPrompt = `Eres el Agente de Requerimientos de SOC. Completa documentos de requerimientos de software siguiendo el estándar R-ISO de SOC (ISO/IEC 20000).

SOC es broker de créditos hipotecarios, PYME y seguros. SISEC es su sistema operativo propio.

Las columnas del Excel se clasifican en:
- SISEC_FUENTE: SISEC ya tiene el dato y se puede extraer vía API
- EVENTO: el dato se obtiene cuando ocurre una acción en SISEC
- CAPTURA_MANUAL: el asesor/área lo registra manualmente
- CALCULADO: derivado por fórmula de otros campos

Tu respuesta debe ser JSON exacto:
{
  "title": "título del requerimiento",
  "introduction": "párrafo introductorio explicando el contexto y la necesidad",
  "current_situation": "situación actual del área sin el sistema",
  "problem_statement": "planteamiento del problema",
  "objective": "objetivo general del requerimiento",
  "benefits": "qué beneficios o mejoras provocará el desarrollo de este sistema",
  "business_policies": "políticas y reglas de negocio que aplican",
  "related_systems": "sistemas relacionados",
  "sisec_integrations": [{"data_name": "", "direction": "READ|WRITE|BIDIRECTIONAL", "sync_frequency": "REALTIME|DAILY|ON_DEMAND|ON_ACTION", "endpoint_hint": "", "fields": [], "is_editable": false, "fallback_behavior": ""}],
  "event_triggers": [{"action": "", "target_field": "", "new_value": "", "condition": ""}],
  "libreta_notes": "qué registra manualmente el asesor que no está en SISEC",
  "systems_questions": [
    {
      "context": "campo o área a la que aplica esta pregunta",
      "question": "pregunta específica para el PM de Sistemas (Silvia Ramírez)",
      "why": "impacto en el desarrollo si no se confirma"
    }
  ],
  "scope": "alcance del desarrollo",
  "out_of_scope": "fuera de alcance",
  "assumptions": "supuestos",
  "constraints": "restricciones técnicas o de negocio",
  "committed_dates": "fechas y compromisos si aplica"
}${rulesContext}`;

    const userMessage = `Completa el requerimiento:

FOLIO: ${req.folio}
TIPO: ${req.doc_type}
TÍTULO: ${req.title}
SITUACIÓN ACTUAL: ${req.current_situation ?? '(no proporcionada)'}
PROBLEMA: ${req.problem_statement ?? '(no proporcionado)'}
OBJETIVO: ${req.objective ?? '(no proporcionado)'}
POLÍTICAS: ${req.business_policies ?? '(no proporcionadas)'}
PM NEGOCIO: ${req.responsible_business ?? ''}
PM SISTEMAS: ${req.responsible_systems ?? 'Silvia Ramírez'}
${excelContext}

Genera el documento completo. En systems_questions incluye 4-6 preguntas específicas sobre disponibilidad de API en SISEC para los campos SISEC_FUENTE identificados.`;

    const result = await this.aiProvider.chat({
      tenantId,
      agentRole: 'ceo',
      systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 8192,
    });

    const rawText = typeof result === 'string' ? result : (result as any).content ?? '';
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
    let generated: any = {};
    if (jsonMatch?.[1]) {
      try { generated = JSON.parse(jsonMatch[1].trim()); } catch { generated = {}; }
    }

    // Extraer wireframes aprobados del cuestionario
    let approvedScreens: any[] = [];
    if (excelData?.questionnaire) {
      try {
        const qaDoc = JSON.parse(excelData.questionnaire.qa_document ?? '{}');
        const reviews = (excelData.questionnaire.area_answers as any)?.screen_reviews ?? {};
        approvedScreens = (qaDoc.screens ?? []).filter((s: any) => reviews[s.id]?.status === 'approved');
        // Si no hay ninguna aprobada explícitamente pero existe al menos 1, incluir todas (aún no revisadas)
        if (approvedScreens.length === 0 && qaDoc.screens?.length > 0) {
          approvedScreens = qaDoc.screens;
        }
      } catch { /* sin pantallas */ }
    }

    const html = this.buildRISOHtml(req, generated, excelData, approvedScreens);

    const updated = await this.prisma.requirement.update({
      where: { id },
      data: {
        title: generated.title ?? req.title,
        current_situation: generated.current_situation ?? req.current_situation,
        problem_statement: generated.problem_statement ?? req.problem_statement,
        objective: generated.objective ?? req.objective,
        business_policies: generated.business_policies ?? req.business_policies,
        related_systems: generated.related_systems ?? req.related_systems,
        sisec_integrations: generated.sisec_integrations ?? req.sisec_integrations,
        event_triggers: generated.event_triggers ?? req.event_triggers,
        libreta_notes: generated.libreta_notes ?? req.libreta_notes,
        scope: generated.scope ?? req.scope,
        out_of_scope: generated.out_of_scope ?? req.out_of_scope,
        assumptions: generated.assumptions ?? req.assumptions,
        constraints: generated.constraints ?? req.constraints,
        committed_dates: generated.committed_dates ?? req.committed_dates,
        ai_generated_doc: { json: generated, html },
        doc_version: this.bumpVersion(req.doc_version),
      },
    });

    await this.recordHistory(id, slotId, 'ai_generated', null, updated.doc_version);
    return updated;
  }

  async getDocumentHtml(tenantId: string, id: string): Promise<{ html: string }> {
    const req = await this.assertAccess(tenantId, id);
    const doc = req.ai_generated_doc as any;
    return { html: doc?.html ?? '' };
  }

  private buildRISOHtml(req: any, generated: any, excelData: any, approvedScreens: any[] = []): string {
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const now = new Date();
    const monthYear = now.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

    const columnMap = (excelData?.column_map ?? {}) as Record<string, string>;
    const byCategory = (cat: string) => Object.entries(columnMap).filter(([, v]) => v === cat);
    const sisecFields = byCategory('SISEC_FUENTE');
    const eventoFields = byCategory('EVENTO');
    const manualFields = byCategory('CAPTURA_MANUAL');
    const calcFields = byCategory('CALCULADO');
    const confirmFields = byCategory('CONFIRMAR');
    const hasExcel = Object.keys(columnMap).length > 0;

    const systemsQuestions: any[] = generated.systems_questions ?? [];

    const tableRows = (fields: [string, string][], extraCells: () => string) =>
      fields.map(([f]) => `<tr><td>${esc(f)}</td>${extraCells()}</tr>`).join('');

    const sqHtml = systemsQuestions.map((q: any, i: number) => `
<div class="sq">
  <div class="sq-num">${i + 1}</div>
  <div class="sq-body">
    ${q.context ? `<div class="sq-ctx">Campo / contexto: ${esc(q.context)}</div>` : ''}
    <div class="sq-q">${esc(q.question)}</div>
    ${q.why ? `<div class="sq-why">Impacto si no se confirma: ${esc(q.why)}</div>` : ''}
    <div class="sq-answer">Respuesta de Sistemas: <span class="aline">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
  </div>
</div>`).join('');

    const p = (txt: string | null | undefined) =>
      txt ? `<p>${esc(txt)}</p>` : '<p class="empty">Pendiente de completar.</p>';

    const title = esc(generated.title ?? req.title ?? 'Requerimiento');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;color:#111;background:#e9ecef}
.page{max-width:900px;margin:32px auto;padding:44px 52px;background:#fff;box-shadow:0 2px 20px rgba(0,0,0,.12)}
.ht{width:100%;border-collapse:collapse;margin-bottom:28px}
.ht td{border:1.5px solid #1f3864;padding:7px 12px;font-size:10.5pt}
.ht .main{font-size:12.5pt;font-weight:700;color:#1f3864;background:#eef2ff;vertical-align:middle}
.ht .center{text-align:center;font-weight:700;color:#1f3864;font-size:10pt}
.ht .lbl{font-weight:700;color:#4b5563;font-size:9.5pt}
h1{font-size:12pt;font-weight:700;color:#1f3864;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #1f3864;padding-bottom:5px;margin:28px 0 14px}
h2{font-size:11.5pt;font-weight:700;color:#1f3864;margin:18px 0 10px}
p{font-size:11pt;line-height:1.65;margin-bottom:10px}
.empty{color:#9ca3af;font-style:italic}
.it{width:100%;border-collapse:collapse;margin-bottom:18px}
.it td{border:1px solid #c7d2e8;padding:7px 12px;font-size:10.5pt}
.it td:first-child{font-weight:700;background:#f0f4ff;width:44%;color:#1f3864}
.dt{width:100%;border-collapse:collapse;margin:10px 0 20px;font-size:10pt}
.dt th{background:#1f3864;color:#fff;padding:7px 12px;text-align:left;font-weight:700}
.dt td{border:1px solid #c7d2e8;padding:6px 12px;vertical-align:top}
.dt tr:nth-child(even) td{background:#f8faff}
.tag{display:inline-block;border-radius:4px;padding:2px 8px;font-size:9pt;font-weight:700;margin-left:6px;vertical-align:middle}
.ts{background:#d1fae5;color:#065f46}.tm{background:#fef3c7;color:#92400e}
.tc{background:#ede9fe;color:#5b21b6}.tq{background:#fee2e2;color:#991b1b}
.notice{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:11px 15px;margin:12px 0;font-size:10pt;color:#78350f}
.sq{display:flex;gap:14px;margin:12px 0;padding:14px 16px;background:#f8faff;border-left:4px solid #1f3864;border-radius:0 6px 6px 0}
.sq-num{flex-shrink:0;width:28px;height:28px;background:#1f3864;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10pt}
.sq-body{flex:1}.sq-ctx{font-size:9pt;color:#6b7280;margin-bottom:4px}
.sq-q{font-weight:700;font-size:10.5pt;margin-bottom:5px}
.sq-why{font-size:9.5pt;color:#4b5563;font-style:italic;margin-bottom:8px}
.sq-answer{font-size:9.5pt;color:#6b7280}
.aline{display:inline-block;border-bottom:1px solid #9ca3af;min-width:260px;margin-left:4px}
.footer{margin-top:40px;padding-top:14px;border-top:1px solid #d1d5db;font-size:9pt;color:#9ca3af;text-align:center}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:20mm 22mm}h1{page-break-after:avoid}.sq{break-inside:avoid}}
</style>
</head>
<body>
<div class="page">

<table class="ht">
  <tr>
    <td class="main" rowspan="3" style="width:42%">${title}</td>
    <td class="center" colspan="2">ACTA DE INICIO DE PROYECTO</td>
    <td class="center">ISO/IEC 20000</td>
  </tr>
  <tr>
    <td class="lbl">FECHA DE ELABORACIÓN</td>
    <td class="lbl">FECHA DE MODIFICACIÓN</td>
    <td class="lbl">PÁGINA</td>
  </tr>
  <tr><td>${monthYear}</td><td>${monthYear}</td><td>1</td></tr>
  <tr><td class="lbl">CLAVE</td><td colspan="3" class="lbl">VERSIÓN</td></tr>
  <tr><td><strong>${req.doc_type === 'MEJORA' ? 'R-ISO-147' : 'R-ISO-81'}</strong></td><td colspan="3">${esc(req.doc_version ?? '1.0')}</td></tr>
</table>

<h1>Introducción</h1>
${p(generated.introduction ?? generated.current_situation ?? req.current_situation)}

<h1>Información del proyecto</h1>
<table class="it">
  <tr><td>Empresa / Organización / Área</td><td>SOC${excelData?.area_name ? ` — ${esc(excelData.area_name)}` : ''}</td></tr>
  <tr><td>Proyecto</td><td>${title}</td></tr>
  <tr><td>Fecha de Inicio</td><td>${req.start_date ? new Date(req.start_date).toLocaleDateString('es-MX') : ''}</td></tr>
  <tr><td>Duración Estimada</td><td>${esc(req.estimated_duration ?? '')}</td></tr>
  <tr><td>Fecha de Terminación Estimada</td><td>${req.due_date ? new Date(req.due_date).toLocaleDateString('es-MX') : ''}</td></tr>
  <tr><td>Responsable del Proyecto Sistemas</td><td>${esc(req.responsible_systems ?? 'Silvia Ramírez')}</td></tr>
  <tr><td>Responsable del Proyecto Negocio</td><td>${esc(req.responsible_business ?? req.requested_by ?? '')}</td></tr>
</table>

<h1>Objetivo General del Requerimiento</h1>
${p(generated.objective ?? req.objective)}

<h1>¿Qué beneficios o mejoras provocará el desarrollo de este Sistema?</h1>
${p(generated.benefits ?? generated.problem_statement ?? req.problem_statement)}

${hasExcel ? `
<h1>Análisis de Datos — Origen e Integración SISEC</h1>

${sisecFields.length > 0 ? `
<h2>1. Datos que SISEC puede proveer automáticamente <span class="tag ts">SISEC_FUENTE</span></h2>
<div class="notice">⚠ Estos campos requieren confirmación del equipo de Sistemas. Ver sección "Consulta a Sistemas" al final del documento.</div>
<table class="dt">
  <thead><tr><th>Campo del Excel</th><th>Tipo de integración</th><th>Frecuencia sugerida</th><th>Confirmación</th></tr></thead>
  <tbody>${tableRows(sisecFields, () => '<td>READ — extracción automática</td><td>Por confirmar</td><td>⬜ Pendiente Sistemas</td>')}</tbody>
</table>` : ''}

${eventoFields.length > 0 ? `
<h2>2. Datos generados por eventos en SISEC <span class="tag ts">EVENTO</span></h2>
<table class="dt">
  <thead><tr><th>Campo del Excel</th><th>Evento que lo genera</th><th>Confirmación</th></tr></thead>
  <tbody>${tableRows(eventoFields, () => '<td>Al completar acción en SISEC</td><td>⬜ Pendiente Sistemas</td>')}</tbody>
</table>` : ''}

${manualFields.length > 0 ? `
<h2>3. Datos que el área capturará manualmente en SISEC <span class="tag tm">CAPTURA_MANUAL</span></h2>
<table class="dt">
  <thead><tr><th>Campo del Excel</th><th>Área responsable</th><th>Frecuencia</th></tr></thead>
  <tbody>${tableRows(manualFields, () => `<td>${esc(excelData?.area_name ?? 'Área')}</td><td>Por confirmar con el área</td>`)}</tbody>
</table>` : ''}

${calcFields.length > 0 ? `
<h2>4. Datos calculados automáticamente <span class="tag tc">CALCULADO</span></h2>
<table class="dt">
  <thead><tr><th>Campo del Excel</th><th>Lógica de cálculo</th></tr></thead>
  <tbody>${tableRows(calcFields, () => '<td>Derivado de datos existentes en SISEC</td>')}</tbody>
</table>` : ''}

${confirmFields.length > 0 ? `
<h2>5. Campos pendientes de aclaración <span class="tag tq">CONFIRMAR</span></h2>
<table class="dt">
  <thead><tr><th>Campo del Excel</th><th>Aclaración requerida</th></tr></thead>
  <tbody>${tableRows(confirmFields, () => '<td>Origen no determinado — requiere respuesta del área</td>')}</tbody>
</table>` : ''}
` : ''}

${systemsQuestions.length > 0 ? `
<h1>Consulta a Sistemas</h1>
<p>El PM de Negocio debe coordinar con el PM de Sistemas (<strong>${esc(req.responsible_systems ?? 'Silvia Ramírez')}</strong>) las siguientes preguntas para confirmar la viabilidad técnica de las integraciones identificadas:</p>
${sqHtml}
` : ''}

<h1>Políticas y Reglas de Negocio</h1>
${p(generated.business_policies ?? req.business_policies)}

<h1>Alcance del Proyecto</h1>
${(generated.scope ?? req.scope) ? `<h2>Dentro del alcance:</h2>${p(generated.scope ?? req.scope)}` : ''}
${(generated.out_of_scope ?? req.out_of_scope) ? `<h2>Fuera del alcance:</h2>${p(generated.out_of_scope ?? req.out_of_scope)}` : ''}

${((generated.assumptions ?? req.assumptions) || (generated.constraints ?? req.constraints)) ? `
<h1>Supuestos y Restricciones</h1>
${(generated.assumptions ?? req.assumptions) ? `<h2>Supuestos:</h2>${p(generated.assumptions ?? req.assumptions)}` : ''}
${(generated.constraints ?? req.constraints) ? `<h2>Restricciones:</h2>${p(generated.constraints ?? req.constraints)}` : ''}
` : ''}

${approvedScreens.length > 0 ? `
<h1>Pantallas del Sistema</h1>
<p>Las siguientes pantallas fueron revisadas y confirmadas por el área solicitante.</p>
${approvedScreens.map((sc: any, i: number) => `
<h2>${i + 1}. ${esc(sc.name ?? '')}</h2>
<p style="font-size:10pt;color:#4b5563;margin-bottom:10px">${esc(sc.description ?? '')}</p>
<div style="border:1.5px solid #c7d2e8;border-radius:6px;overflow:auto;margin-bottom:20px;background:#fafafa;padding:12px">
${sc.html ?? ''}
</div>`).join('')}
` : ''}

<h1>Plataformas o sistemas con los que debe interactuar</h1>
${p(generated.related_systems ?? req.related_systems)}

<h1>Flujo del requerimiento</h1>
<p class="empty">Anexar diagrama o flujo del proceso aquí.</p>

<h1>Información adicional del proyecto</h1>
${p(generated.committed_dates ?? req.committed_dates)}

<h1>Firmas</h1>
<table class="it" style="margin-top:12px">
  <tr>
    <td style="width:50%;padding:18px 14px;vertical-align:top">
      <div style="font-weight:700;color:#1f3864;margin-bottom:32px">Elaboró</div>
      <div style="border-top:1px solid #374151;padding-top:6px;font-size:10pt">${esc(req.requested_by ?? '')}<br><span style="color:#6b7280;font-size:9.5pt">${esc(req.requested_by_email ?? '')}</span></div>
    </td>
    <td style="width:50%;padding:18px 14px;vertical-align:top">
      <div style="font-weight:700;color:#1f3864;margin-bottom:32px">Revisó</div>
      <div style="border-top:1px solid #374151;padding-top:6px;font-size:10pt">${esc(req.responsible_business ?? '')}<br><span style="color:#6b7280;font-size:9.5pt">Project Manager</span></div>
    </td>
  </tr>
  <tr>
    <td style="padding:18px 14px;vertical-align:top">
      <div style="font-weight:700;color:#1f3864;margin-bottom:32px">Aprobó</div>
      <div style="border-top:1px solid #374151;padding-top:6px;font-size:10pt">${esc(req.responsible_systems ?? 'Silvia Ramírez')}<br><span style="color:#6b7280;font-size:9.5pt">PM Sistemas</span></div>
    </td>
    <td style="padding:18px 14px;vertical-align:top">
      <div style="font-weight:700;color:#1f3864;margin-bottom:32px">Aprobó</div>
      <div style="border-top:1px solid #374151;padding-top:6px;font-size:10pt">&nbsp;<br><span style="color:#6b7280;font-size:9.5pt">&nbsp;</span></div>
    </td>
  </tr>
</table>

<div class="footer">
  Documento generado por el Agente de Requerimientos FlowDesk &bull; ${now.toLocaleString('es-MX')} &bull; Folio: ${esc(req.folio ?? 'N/A')}
</div>
</div>
</body>
</html>`;
  }

  async delete(tenantId: string, id: string) {
    await this.assertAccess(tenantId, id);
    return this.prisma.requirement.delete({ where: { id } });
  }

  // ── helpers ───────────────────────────────────────────────────────

  private async assertAccess(tenantId: string, id: string) {
    const req = await this.prisma.requirement.findFirst({ where: { id, tenant_id: tenantId } });
    if (!req) throw new NotFoundException('Requerimiento no encontrado');
    return req;
  }

  private async generateFolio(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.requirement.count({ where: { tenant_id: tenantId } });
    return `REQ-SOC-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  private bumpVersion(current: string): string {
    const parts = (current ?? '1.0').split('.');
    return `${parts[0]}.${parseInt(parts[1] ?? '0') + 1}`;
  }

  private async recordHistory(requirementId: string, slotId: string, action: string, fromValue?: string | null, toValue?: string | null, notes?: string | null) {
    return this.prisma.requirementHistory.create({
      data: { requirement_id: requirementId, slot_id: slotId, action, from_value: fromValue ?? null, to_value: toValue ?? null, notes: notes ?? null },
    });
  }
}
