import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiProviderService } from '../../ai/ai-provider.service';
import { CreateIntakeTokenDto, AnswerQuestionnaireDto } from './dto/excel-intake.dto';

@Injectable()
export class ExcelIntakeService {
  constructor(
    private prisma: PrismaService,
    private aiProvider: AiProviderService,
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

    // Analizar columnas con IA de forma asíncrona
    this.analyzeExcel(upload.id, intakeToken.tenant_id).catch(console.error);

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

    const excelContext = `Área: ${upload.area_name}
Archivo: ${upload.file_name ?? 'Excel'}
CONFIRMAR: ${byCategory('CONFIRMAR').join(', ') || 'ninguno'}
CAPTURA_MANUAL: ${byCategory('CAPTURA_MANUAL').join(', ') || 'ninguno'}
SISEC_FUENTE: ${byCategory('SISEC_FUENTE').join(', ') || 'ninguno'}
CALCULADO: ${byCategory('CALCULADO').join(', ') || 'ninguno'}
Notas: ${upload.analysis_notes?.slice(0, 600) ?? '(ninguna)'}`;

    // ── Llamado 1: Preguntas y supuestos ──────────────────────────────────────
    const sysQ = `Eres el Agente de Requerimientos de SOC (broker hipotecario). Analiza el contexto de un Excel del área y genera:
1. Preguntas de clarificación (máx 8, lenguaje claro y no técnico)
2. Supuestos que el agente está asumiendo sobre el negocio (máx 5)

Responde SOLO con JSON:
{
  "questions": [{"id":"q1","section":"Confirmación de campos","field":"NombreCampo o null","question":"¿...?","why":"Para poder..."}],
  "assumptions": [{"id":"a1","text":"Asumimos que...","context":"Contexto o impacto de este supuesto"}]
}`;

    const r1 = await this.aiProvider.chat({
      tenantId, agentRole: 'ceo', systemPrompt: sysQ,
      messages: [{ role: 'user', content: excelContext }],
      maxTokens: 3000,
    });
    const t1 = typeof r1 === 'string' ? r1 : (r1 as any).content ?? '';
    const m1 = t1.match(/```(?:json)?\s*([\s\S]*?)```/) ?? t1.match(/(\{[\s\S]*\})/);
    let part1: any = { questions: [], assumptions: [] };
    if (m1?.[1]) { try { part1 = JSON.parse(m1[1].trim()); } catch { /* keep default */ } }

    // ── Llamado 2: Wireframes de pantallas propuestas ─────────────────────────
    const manualFields = byCategory('CAPTURA_MANUAL');
    const sisecFields  = byCategory('SISEC_FUENTE');
    const calcFields   = byCategory('CALCULADO');

    const sysW = `Eres un diseñador UX de sistemas internos para SOC (broker hipotecario). Genera wireframes HTML compactos de las pantallas que habrá que construir en SISEC para reemplazar el Excel del área.

IMPORTANTE — Genera HTML auto-contenido con estilos inline. Sigue esta guía de estilo:
- Encabezado: fondo #1f3864, texto blanco, padding 10px 16px, font-size 13px, font-weight 700
- Filtros: fondo #eef2ff, border-radius 20px, padding 4px 12px, font-size 12px, color #1f3864
- Tablas: border-collapse collapse, header con fondo #f8faff, celdas con border 1px solid #e5e7eb, padding 8px 12px, font-size 13px
- Formularios: inputs con border 1px solid #d1d5db, border-radius 6px, padding 8px, font-size 13px
- Botones de acción: fondo #0d6efd, color blanco, border-radius 6px, padding 6px 14px, font-size 12px
- Tags de estado: colores semánticos (verde #d1fae5/#065f46, amarillo #fef3c7/#92400e, rojo #fee2e2/#991b1b)
- Máximo 50 líneas HTML por pantalla
- Usa datos de ejemplo realistas del contexto del área
- NO uses CSS externo, NO uses clases, solo estilos inline

Genera 2-3 pantallas clave del módulo. Responde SOLO con JSON:
{
  "screens": [
    {
      "id": "s1",
      "name": "Nombre de la pantalla",
      "description": "Qué hace esta pantalla y quién la usa",
      "html": "<div style='font-family:system-ui,sans-serif;max-width:720px'>...</div>"
    }
  ]
}`;

    const r2 = await this.aiProvider.chat({
      tenantId, agentRole: 'ceo', systemPrompt: sysW,
      messages: [{ role: 'user', content: `${excelContext}

Campos de captura manual (formulario): ${manualFields.join(', ')}
Campos de SISEC (mostrar en tabla/read-only): ${sisecFields.join(', ')}
Campos calculados (mostrar con formato especial): ${calcFields.join(', ')}
Análisis: ${upload.analysis_notes?.slice(0, 400) ?? ''}

Genera los wireframes HTML de las pantallas principales del módulo para el área de ${upload.area_name}.` }],
      maxTokens: 6144,
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

    await this.prisma.areaQuestionnaire.create({
      data: { excel_upload_id: uploadId, qa_document: JSON.stringify(qaDoc) },
    });

    await this.prisma.excelUpload.update({ where: { id: uploadId }, data: { status: 'CUESTIONARIO_GENERADO' } });
  }

  async answerByToken(token: string, dto: AnswerQuestionnaireDto) {
    const intakeToken = await this.prisma.intakeToken.findUnique({
      where: { token },
      include: { excel_upload: true },
    });
    if (!intakeToken) throw new NotFoundException('Token no válido');
    return this.answerQuestionnaire(intakeToken.tenant_id, intakeToken.excel_upload_id!, dto);
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
