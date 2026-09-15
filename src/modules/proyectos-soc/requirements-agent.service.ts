import { Injectable } from '@nestjs/common';
import { AiProviderService } from '../../ai/ai-provider.service';
import { AiTool } from '../../ai/interfaces/ai-provider.interface';
import { RequirementsService } from './requirements.service';
import { BusinessRulesService } from './business-rules.service';

const SYSTEM_PROMPT = `Eres el Analista de Requerimientos IA de SOC Asesores. Tu única función es ayudar al equipo a documentar requerimientos IT en formato R-ISO-147 (norma ISO/IEC 20000).

COMPORTAMIENTO:
- Haz máximo 3 preguntas de clarificación por sesión, priorizando los campos más críticos (título, área solicitante, situación actual, objetivo).
- Guarda el borrador en DB tan pronto tengas título + área solicitante + situación actual. No esperes tener todos los campos para llamar extraer_requerimiento.
- Antes de generar el documento final, presenta un resumen de los campos capturados y pide confirmación explícita del asesor.
- Si el asesor corrige un campo, llama actualizar_campo de inmediato.
- El documento debe estar listo antes del turno 10 de la conversación.

REGLAS:
- Nunca inventes información. Si un campo no fue mencionado, pregunta o déjalo en blanco.
- El campo Elaboró corresponde al usuario logueado — no lo preguntes.
- Folio, versión, fecha y clave del documento son automáticos — no los preguntes.
- Si el asesor pregunta algo fuera del ámbito de requerimientos SOC, declina con cortesía y redirige.

FLUJO:
1. El asesor describe el requerimiento.
2. Haces las preguntas faltantes (máx 3).
3. Llamas extraer_requerimiento → guarda borrador.
4. Llamas buscar_reglas_negocio → propones reglas aplicables.
5. Presentas resumen y confirmas con el asesor.
6. Llamas generar_documento → entrega link al documento.`;

const TOOLS: AiTool[] = [
  {
    name: 'extraer_requerimiento',
    description:
      'Crea un nuevo requerimiento en DB con los campos extraídos de la conversación. Llamar tan pronto se tenga título, área y situación actual. Devuelve el id y folio creados.',
    input_schema: {
      type: 'object',
      properties: {
        title:             { type: 'string', description: 'Título del requerimiento' },
        area_solicitante:  { type: 'string', description: 'Área o departamento que solicita' },
        responsable:       { type: 'string', description: 'Nombre del responsable del área' },
        current_situation: { type: 'string', description: 'Situación actual / problema' },
        objective:         { type: 'string', description: 'Objetivo general' },
        related_systems:   { type: 'string', description: 'Plataformas o sistemas que interactúan' },
        sisec_modules:     { type: 'string', description: 'Módulos de SISEC afectados' },
        due_date:          { type: 'string', description: 'Fecha requerida de entrega (ISO 8601)' },
        priority:          { type: 'string', enum: ['ALTA', 'MEDIA', 'BAJA'] },
        committed_dates:   { type: 'string', description: 'Fechas de compromiso acordadas' },
        additional_info:   { type: 'string', description: 'Información adicional' },
        reviso_nombre:     { type: 'string', description: 'Nombre de quien revisa' },
        reviso_cargo:      { type: 'string', description: 'Cargo de quien revisa' },
        aprobo_1_nombre:   { type: 'string', description: 'Nombre del primer aprobador' },
        aprobo_2_nombre:   { type: 'string', description: 'Nombre del segundo aprobador' },
      },
      required: ['title', 'area_solicitante', 'current_situation'],
    },
  },
  {
    name: 'actualizar_campo',
    description:
      'Actualiza uno o más campos de un requerimiento ya creado. Llamar cuando el asesor corrija o agregue información.',
    input_schema: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string', description: 'ID del requerimiento (de extraer_requerimiento)' },
        campos: { type: 'object', description: 'Campos a actualizar con sus nuevos valores' },
      },
      required: ['requirement_id', 'campos'],
    },
  },
  {
    name: 'buscar_reglas_negocio',
    description:
      'Consulta las reglas de negocio activas del tenant para identificar cuáles aplican al requerimiento. Llamar antes de generar el documento.',
    input_schema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Palabras clave para filtrar reglas relevantes',
        },
      },
      required: [],
    },
  },
  {
    name: 'generar_documento',
    description:
      'Genera el documento R-ISO-147 completo en HTML una vez que el asesor confirmó que la información está completa.',
    input_schema: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string', description: 'ID del requerimiento a documentar' },
        include_rules:  { type: 'boolean', description: 'Incluir reglas de negocio. Default: true' },
      },
      required: ['requirement_id'],
    },
  },
];

@Injectable()
export class RequirementsAgentService {
  constructor(
    private readonly aiProvider: AiProviderService,
    private readonly requirementsService: RequirementsService,
    private readonly businessRulesService: BusinessRulesService,
  ) {}

  async chat(
    tenantId: string,
    slotId: string | null,
    dto: {
      message: string;
      requirement_id?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    },
  ): Promise<{ response: string; requirement_id?: string; document_url?: string }> {
    let requirementId = dto.requirement_id;
    let documentUrl: string | undefined;

    const result = await this.aiProvider.chatWithTools({
      tenantId,
      agentRole: 'ceo',
      systemBlocks: [{ type: 'text', text: SYSTEM_PROMPT }],
      historyMessages: dto.history ?? [],
      userMessage: dto.message,
      tools: TOOLS,
      maxTokens: 4096,
      maxIterations: 6,
      toolExecutor: async (name, input) => {
        const toolResult = await this.executeTool(name, input, tenantId, slotId, requirementId);
        if (toolResult.newRequirementId) {
          requirementId = toolResult.newRequirementId;
          delete toolResult.newRequirementId;
        }
        if (name === 'generar_documento' && toolResult.document_url) {
          documentUrl = toolResult.document_url;
        }
        return toolResult;
      },
    });

    return { response: result.response, requirement_id: requirementId, document_url: documentUrl };
  }

  private async executeTool(
    name: string,
    input: Record<string, any>,
    tenantId: string,
    slotId: string | null,
    requirementId?: string,
  ): Promise<Record<string, any>> {
    switch (name) {
      case 'extraer_requerimiento': {
        const req = await this.requirementsService.create(tenantId, slotId, {
          title: input.title,
          doc_type: 'MEJORA' as any,
          intake_source: 'DIAGNOSTICO' as any,
          current_situation: input.current_situation,
          objective: input.objective,
          related_systems: input.related_systems,
          committed_dates: input.committed_dates,
          responsible_business: input.area_solicitante,
          requested_by: input.responsable,
          due_date: input.due_date,
          business_policies: input.business_policies,
          constraints: input.additional_info,
        });
        return { newRequirementId: req.id, id: req.id, folio: req.folio };
      }

      case 'actualizar_campo': {
        const id = input.requirement_id ?? requirementId;
        if (!id) return { error: 'No hay un requerimiento activo' };
        const req = await this.requirementsService.update(tenantId, slotId ?? '', id, input.campos);
        return { ok: true, folio: (req as any).folio };
      }

      case 'buscar_reglas_negocio': {
        const rules = await this.businessRulesService.findAll(tenantId, { is_active: true });
        const keywords: string[] = input.keywords ?? [];
        const filtered = keywords.length > 0
          ? rules
              .filter(r =>
                keywords.some(k =>
                  r.name.toLowerCase().includes(k.toLowerCase()) ||
                  r.description.toLowerCase().includes(k.toLowerCase()),
                ),
              )
              .slice(0, 5)
          : rules.slice(0, 5);
        return filtered.map(r => ({ id: r.id, name: r.name, description: r.description, category: r.category }));
      }

      case 'generar_documento': {
        const id = input.requirement_id ?? requirementId;
        if (!id) return { error: 'No hay un requerimiento activo. Usa extraer_requerimiento primero.' };
        await this.requirementsService.generateDocument(tenantId, slotId ?? '', id, {
          include_rules: input.include_rules ?? true,
        });
        return { ok: true, document_url: `/proyectos/${id}/documento` };
      }

      default:
        return { error: `Tool desconocida: ${name}` };
    }
  }
}
