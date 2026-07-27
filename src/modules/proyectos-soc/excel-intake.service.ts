import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiProviderService } from '../../ai/ai-provider.service';
import { RequirementsService } from './requirements.service';
import { CreateIntakeTokenDto, AnswerQuestionnaireDto } from './dto/excel-intake.dto';

@Injectable()
export class ExcelIntakeService {
  constructor(
    private prisma: PrismaService,
    private aiProvider: AiProviderService,
    private requirementsService: RequirementsService,
  ) {}

  // ── PM: gestión de tokens y uploads ───────────────────────────────

  async createToken(tenantId: string, dto: CreateIntakeTokenDto) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (dto.expires_days ?? 7));

    const upload = await this.prisma.excelUpload.create({
      data: {
        tenant_id: tenantId,
        area_name: dto.area_name,
        area_email: dto.area_email,
        status: 'PENDIENTE_SUBIDA',
      },
    });

    const token = await this.prisma.intakeToken.create({
      data: {
        tenant_id: tenantId,
        area_name: dto.area_name,
        area_email: dto.area_email,
        excel_upload_id: upload.id,
        expires_at: expiresAt,
      },
    });

    return { token: token.token, upload_id: upload.id, expires_at: expiresAt };
  }

  listUploads(tenantId: string) {
    return this.prisma.excelUpload.findMany({
      where: { tenant_id: tenantId },
      include: {
        questionnaire: true,
        requirement: { select: { id: true, folio: true, status: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getUpload(tenantId: string, id: string) {
    const upload = await this.prisma.excelUpload.findFirst({
      where: { id, tenant_id: tenantId },
      include: { questionnaire: true, requirement: true },
    });
    if (!upload) throw new NotFoundException('Upload no encontrado');
    return upload;
  }

  // ── Público: área sube Excel usando su token ───────────────────────

  async getUploadByToken(token: string) {
    const intakeToken = await this.prisma.intakeToken.findUnique({
      where: { token },
      include: { excel_upload: { include: { questionnaire: true } } },
    });
    if (!intakeToken) throw new NotFoundException('Link no válido');
    if (intakeToken.is_used) throw new BadRequestException('Este link ya fue utilizado');
    if (new Date() > intakeToken.expires_at) throw new BadRequestException('Este link ha expirado');
    return intakeToken;
  }

  async submitExcelContent(token: string, content: string, fileName?: string) {
    const intakeToken = await this.getUploadByToken(token);

    const upload = await this.prisma.excelUpload.update({
      where: { id: intakeToken.excel_upload_id! },
      data: {
        raw_content: content,
        file_name: fileName,
        status: 'SUBIDO',
        uploaded_at: new Date(),
      },
    });

    // Analizar con IA de forma asíncrona; nunca bloquear la respuesta
    this.analyzeExcel(upload.id, intakeToken.tenant_id).catch(async (err) => {
      console.error(`[intake] analyzeExcel falló para upload ${upload.id}:`, err?.message ?? err);
      // Crear cuestionario de respaldo para que el polling siempre encuentre algo
      await this.createFallbackQuestionnaire(upload.id, upload.area_name, upload.raw_content ?? '');
    });

    return { message: 'Archivo recibido. El análisis iniciará en breve.' };
  }

  async analyzeExcel(uploadId: string, tenantId: string) {
    const upload = await this.prisma.excelUpload.findUnique({ where: { id: uploadId } });
    if (!upload?.raw_content) return;

    await this.prisma.excelUpload.update({ where: { id: uploadId }, data: { status: 'ANALIZANDO' } });

    const systemPrompt = `Eres un agente analizador de Excel para SOC, empresa broker de créditos hipotecarios, PYME y seguros.
SISEC es su sistema operativo propio que gestiona todo el workflow.

Analiza las columnas del Excel y clasifica cada una en una de estas categorías:
- SISEC_FUENTE: dato que SISEC ya tiene y se puede extraer vía API
- EVENTO: dato que se obtiene cuando ocurre una acción en SISEC (envío, aprobación, completar etapa)
- CAPTURA_MANUAL: dato que el asesor registra manualmente durante su trabajo (libreta digital)
- CALCULADO: dato derivado por fórmula a partir de otros campos
- CONFIRMAR: no se puede clasificar sin más contexto, requiere confirmación del área

Responde SOLO con JSON:
{
  "column_map": { "NombreColumna": "CATEGORIA" },
  "analysis_notes": "observaciones generales sobre el Excel y cómo se usará en SISEC"
}`;

    const result = await this.aiProvider.chat({
      tenantId,
      agentRole: 'ceo',
      systemPrompt,
      messages: [{ role: 'user', content: `Clasifica las columnas de este Excel del área ${upload.area_name}:\n\n${upload.raw_content?.slice(0, 6000)}` }],
      maxTokens: 2048,
    });

    const rawText = typeof result === 'string' ? result : (result as any).content ?? '';
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
    let parsed: any = {};
    if (jsonMatch?.[1]) {
      try { parsed = JSON.parse(jsonMatch[1].trim()); } catch { parsed = {}; }
    }

    await this.prisma.excelUpload.update({
      where: { id: uploadId },
      data: {
        column_map: parsed.column_map ?? {},
        analysis_notes: parsed.analysis_notes,
        status: 'ANALIZADO',
        analyzed_at: new Date(),
      },
    });

    // Generar cuestionario automáticamente
    await this.generateQuestionnaire(uploadId, tenantId);
  }

  async generateQuestionnaire(uploadId: string, tenantId: string) {
    const upload = await this.prisma.excelUpload.findUnique({ where: { id: uploadId } });
    if (!upload) return;

    const columnMap = (upload.column_map ?? {}) as Record<string, string>;
    const byCategory = (cat: string) => Object.entries(columnMap).filter(([, v]) => v === cat).map(([k]) => k);

    // Incluir descripción del proceso si viene del intake estructurado
    const rawContent = upload.raw_content ?? '';
    const descMatch  = rawContent.match(/=== Descripción del proceso ===([\s\S]*?)(?:=== Datos del Excel ===|$)/);
    const processDesc = descMatch?.[1]?.trim() ?? '';

    const excelContext = `Área: ${upload.area_name}
Archivo: ${upload.file_name ?? 'Excel'}
${processDesc ? `Descripción del proceso: ${processDesc.slice(0, 800)}` : ''}
CONFIRMAR: ${byCategory('CONFIRMAR').join(', ') || 'ninguno'}
CAPTURA_MANUAL: ${byCategory('CAPTURA_MANUAL').join(', ') || 'ninguno'}
SISEC_FUENTE: ${byCategory('SISEC_FUENTE').join(', ') || 'ninguno'}
CALCULADO: ${byCategory('CALCULADO').join(', ') || 'ninguno'}
Notas: ${upload.analysis_notes?.slice(0, 600) ?? '(ninguna)'}`.trim();

    // ── Llamado 1: Preguntas y supuestos ──────────────────────────────────────
    const sysQ = `Eres el Agente de Requerimientos de SOC (broker hipotecario). Analiza el contexto de un proceso del área y genera:
1. Preguntas de clarificación (máx 6, lenguaje claro y no técnico)
2. Supuestos que el agente está asumiendo sobre el negocio (máx 4)

Responde SOLO con JSON válido:
{"questions":[{"id":"q1","section":"Sección","field":null,"question":"¿...?","why":"Para poder..."}],"assumptions":[{"id":"a1","text":"Asumimos que...","context":"Contexto o impacto"}]}`;

    const r1 = await this.aiProvider.chat({
      tenantId, agentRole: 'ceo', systemPrompt: sysQ,
      messages: [{ role: 'user', content: excelContext }],
      maxTokens: 2000,
    });
    const t1 = typeof r1 === 'string' ? r1 : (r1 as any).content ?? '';
    const m1 = t1.match(/```(?:json)?\s*([\s\S]*?)```/) ?? t1.match(/(\{[\s\S]*\})/);
    let part1: any = { questions: [], assumptions: [] };
    if (m1?.[1]) { try { part1 = JSON.parse(m1[1].trim()); } catch { /* keep default */ } }

    // ── Llamado 2: Wireframes de pantallas propuestas ─────────────────────────
    const manualFields = byCategory('CAPTURA_MANUAL');
    const sisecFields  = byCategory('SISEC_FUENTE');
    const calcFields   = byCategory('CALCULADO');

    const sysW = `Eres un diseñador UX de sistemas internos para SOC (broker hipotecario). Genera wireframes HTML compactos de las pantallas que habrá que construir en SISEC para digitalizar el proceso del área.

IMPORTANTE — HTML auto-contenido con estilos inline únicamente:
- Encabezado: fondo #1f3864, texto blanco, padding 10px 16px, font-size 13px, font-weight 700
- Tablas: border-collapse collapse, header fondo #f8faff, celdas border 1px solid #e5e7eb, padding 8px 12px, font-size 13px
- Formularios: inputs border 1px solid #d1d5db, border-radius 6px, padding 8px, font-size 13px
- Botones: fondo #0d6efd, color blanco, border-radius 6px, padding 6px 14px, font-size 12px
- Máximo 40 líneas HTML por pantalla, datos de ejemplo realistas
- NO uses CSS externo ni clases

Genera 2 pantallas clave. Responde SOLO con JSON válido:
{"screens":[{"id":"s1","name":"Nombre","description":"Qué hace y quién la usa","html":"<div style='font-family:system-ui'>...</div>"}]}`;

    const r2 = await this.aiProvider.chat({
      tenantId, agentRole: 'ceo', systemPrompt: sysW,
      messages: [{ role: 'user', content: `${excelContext}\n\nCampos de captura manual: ${manualFields.join(', ') || 'ver descripción'}\nCampos de SISEC: ${sisecFields.join(', ') || 'ver descripción'}\nCampos calculados: ${calcFields.join(', ') || 'ninguno'}` }],
      maxTokens: 5000,
    });
    const t2 = typeof r2 === 'string' ? r2 : (r2 as any).content ?? '';
    const m2 = t2.match(/```(?:json)?\s*([\s\S]*?)```/) ?? t2.match(/(\{[\s\S]*\})/);
    let part2: any = { screens: [] };
    if (m2?.[1]) { try { part2 = JSON.parse(m2[1].trim()); } catch { /* keep default */ } }

    const qaDoc = {
      questions:   part1.questions   ?? [],
      assumptions: part1.assumptions ?? [],
      screens:     part2.screens     ?? [],
    };

    // Upsert para evitar error de unique constraint si ya existe
    await this.prisma.areaQuestionnaire.upsert({
      where: { excel_upload_id: uploadId },
      create: { excel_upload_id: uploadId, qa_document: JSON.stringify(qaDoc) },
      update: { qa_document: JSON.stringify(qaDoc) },
    });

    await this.prisma.excelUpload.update({ where: { id: uploadId }, data: { status: 'CUESTIONARIO_GENERADO' } });
  }

  async createFallbackQuestionnaire(uploadId: string, areaName: string, rawContent: string) {
    const descMatch   = rawContent.match(/=== Descripción del proceso ===([\s\S]*?)(?:=== Datos del Excel ===|$)/);
    const processDesc = descMatch?.[1]?.trim() ?? rawContent.slice(0, 400);

    const qaDoc = {
      questions: [
        { id: 'q1', section: 'Proceso', field: null, question: '¿Cuál es el objetivo principal de este desarrollo?', why: 'Para enfocar el alcance del requerimiento.' },
        { id: 'q2', section: 'Usuarios', field: null, question: '¿Quiénes usarán este módulo y con qué frecuencia?', why: 'Para dimensionar la carga y los permisos.' },
        { id: 'q3', section: 'Integración', field: null, question: '¿Hay sistemas externos que deban conectarse a este módulo?', why: 'Para identificar integraciones necesarias.' },
      ],
      assumptions: [
        { id: 'a1', text: `El módulo será usado por el área de ${areaName}.`, context: 'Basado en la solicitud recibida.' },
        { id: 'a2', text: 'El desarrollo seguirá los estándares de SISEC existentes.', context: 'Para mantener consistencia con el sistema actual.' },
      ],
      screens: [],
      _fallback: true,
      _processDesc: processDesc.slice(0, 200),
    };

    await this.prisma.areaQuestionnaire.upsert({
      where: { excel_upload_id: uploadId },
      create: { excel_upload_id: uploadId, qa_document: JSON.stringify(qaDoc) },
      update: { qa_document: JSON.stringify(qaDoc) },
    });

    await this.prisma.excelUpload.update({ where: { id: uploadId }, data: { status: 'CUESTIONARIO_GENERADO' } });
  }

  async answerByToken(token: string, dto: AnswerQuestionnaireDto) {
    const intakeToken = await this.prisma.intakeToken.findUnique({
      where: { token },
      include: { excel_upload: true },
    });
    if (!intakeToken) throw new NotFoundException('Token no válido');

    const result = await this.answerQuestionnaire(intakeToken.tenant_id, intakeToken.excel_upload_id!, dto);

    // Auto-crear requerimiento si no existe aún para este upload
    let requirement: { id: string; folio: string } | null = null;
    try {
      const existing = await this.prisma.requirement.findFirst({
        where: { excel_upload_id: intakeToken.excel_upload_id! },
        select: { id: true, folio: true },
      });
      if (existing) {
        requirement = existing;
      } else {
        requirement = await this.requirementsService.createFromIntake(
          intakeToken.tenant_id,
          null,
          intakeToken.excel_upload_id!,
        );
      }
    } catch (err) {
      console.error('[intake] auto-create requirement falló:', err?.message ?? err);
    }

    return { ...result, requirement };
  }

  async answerQuestionnaire(tenantId: string, uploadId: string, dto: AnswerQuestionnaireDto) {
    const upload = await this.prisma.excelUpload.findFirst({ where: { id: uploadId, tenant_id: tenantId } });
    if (!upload) throw new NotFoundException('Upload no encontrado');

    const answers = dto.area_answers as any;
    const screenReviews: Record<string, any> = answers?.screen_reviews ?? {};
    const allApproved = Object.keys(screenReviews).length > 0 &&
      Object.values(screenReviews).every((r: any) => r?.status === 'approved');
    const qaStatus = allApproved ? 'APROBADO' : 'EN_REVISION';

    await this.prisma.areaQuestionnaire.update({
      where: { excel_upload_id: uploadId },
      data: { area_answers: dto.area_answers, answered_at: new Date(), status: qaStatus },
    });

    await this.prisma.excelUpload.update({ where: { id: uploadId }, data: { status: 'RESPONDIDO' } });
    return { message: 'Confirmación enviada al equipo de Proyectos SOC.', qa_status: qaStatus };
  }
}
