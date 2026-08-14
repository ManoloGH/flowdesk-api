import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from '../../ai/ai-provider.service';
import { MentoriaService } from './mentoria.service';

const SYSTEM_PROMPT = `You are the diagnostic analysis engine for MentorIA Systems, a business automation consultancy.

Your job: analyze raw diagnostic questionnaire data from a client company and produce structured findings.

Output ONLY valid JSON. No markdown, no explanations outside the JSON structure.

Always respond in Spanish.`;

const ANALISIS_PROMPT = (clienteNombre: string, datos: any[]) => `
Analiza los datos de diagnóstico del cliente "${clienteNombre}".

Datos recopilados por área:
${datos.map(d => `\n--- ÁREA: ${d.area.toUpperCase()} ---\n${JSON.stringify(d.datos, null, 2)}`).join('\n')}

Genera un análisis estructurado con este JSON exacto:
{
  "resumen_ejecutivo": "2-3 oraciones sobre el estado general de la empresa",
  "hallazgos": [
    {
      "area": "nombre del área",
      "tipo": "critico|importante|positivo|oportunidad_ia",
      "titulo": "título conciso del hallazgo",
      "descripcion": "explicación del hallazgo con evidencia de los datos",
      "impacto": "impacto estimado en tiempo o dinero"
    }
  ],
  "plan_de_accion": [
    {
      "titulo": "acción concreta a tomar",
      "area": "área afectada",
      "prioridad": "alta|media|baja",
      "responsable": "MentorIA|Cliente|Ambos",
      "fecha_estimada_semanas": 2,
      "notas": "contexto adicional o dependencias"
    }
  ],
  "roi_estimado": "estimación de ahorro o ganancia mensual en MXN",
  "roadmap_5_fases": {
    "fase_1": { "titulo": "Data & Comunicación", "items": ["proceso → qué data se genera y cómo fluye"] },
    "fase_2": { "titulo": "Entregables & Reglas", "items": ["SOP o entregable a estandarizar"] },
    "fase_3": { "titulo": "Automatizaciones", "items": ["flujo o notificación a automatizar"] },
    "fase_4": { "titulo": "Agente Conectado", "items": ["agente IA conectado a herramientas existentes"] },
    "fase_5": { "titulo": "Agente Autónomo", "items": ["proceso end-to-end gestionado por agente"] }
  }
}

Reglas:
- Incluye entre 4 y 10 hallazgos ordenados por impacto (críticos primero)
- Incluye entre 3 y 8 acciones del plan, priorizadas
- Si hay datos de múltiples áreas, cruza la información para encontrar patrones
- Los hallazgos tipo "oportunidad_ia" son procesos que se pueden automatizar con IA
- Sé específico: usa datos reales de las respuestas, no generalices
`;

@Injectable()
export class MentoriaProcesamientoService {
  private readonly logger = new Logger(MentoriaProcesamientoService.name);

  constructor(
    private readonly ai: AiProviderService,
    private readonly mentoria: MentoriaService,
  ) {}

  async procesarDiagnostico(tenantId: string, clienteId: string): Promise<{
    hallazgos: any[];
    plan: any[];
    resumen: string;
    roi: string;
    roadmap_5_fases: any | null;
  }> {
    const cliente = await this.mentoria.getCliente(tenantId, clienteId);
    const diagnosticos = await this.mentoria.getAllDiagnosticoData(clienteId);

    if (!diagnosticos.length) {
      throw new Error('No hay datos de diagnóstico para procesar. Completa al menos un formulario.');
    }

    this.logger.log(`Procesando diagnóstico de ${cliente.empresa} (${diagnosticos.length} áreas)`);

    const rawResponse = await this.ai.chat({
      tenantId,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: ANALISIS_PROMPT(cliente.empresa, diagnosticos) }],
      modelOverride: 'anthropic/claude-sonnet-4-6',
    });

    const text = rawResponse.response ?? '';

    let parsed: any;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      this.logger.error('Error parseando respuesta de IA', text);
      throw new Error('Error al procesar la respuesta del análisis. Intenta de nuevo.');
    }

    // Guardar hallazgos en BD
    const hallazgosCreados: any[] = [];
    for (const h of (parsed.hallazgos ?? [])) {
      const hallazgo = await this.mentoria.createHallazgo(tenantId, clienteId, {
        area: h.area,
        tipo: h.tipo,
        titulo: h.titulo,
        descripcion: h.descripcion,
        impacto: h.impacto,
      });
      hallazgosCreados.push(hallazgo);
    }

    // Guardar plan de acción en BD
    const accionesCreadas: any[] = [];
    for (const a of (parsed.plan_de_accion ?? [])) {
      const semanas = a.fecha_estimada_semanas ?? 4;
      const fechaEstimada = new Date();
      fechaEstimada.setDate(fechaEstimada.getDate() + semanas * 7);

      const accion = await this.mentoria.createAccion(tenantId, clienteId, {
        titulo: a.titulo,
        area: a.area,
        prioridad: a.prioridad ?? 'media',
        responsable: a.responsable ?? 'MentorIA',
        fecha_estimada: fechaEstimada.toISOString(),
        notas: a.notas,
      });
      accionesCreadas.push(accion);
    }

    // Marcar diagnósticos como procesados
    await this.mentoria.markDiagnosticoProcesado(clienteId);

    // Guardar roadmap_5_fases en el cubo del cliente
    if (parsed.roadmap_5_fases) {
      try {
        const clienteActual = await this.mentoria.getCliente(tenantId, clienteId);
        const cuboActual = (clienteActual as any).cubo ?? {};
        const roadmapText = Object.entries(parsed.roadmap_5_fases as Record<string, {titulo: string; items: string[]}>)
          .map(([fase, data]) => `${fase.toUpperCase()} — ${data.titulo}\n${(data.items ?? []).map((i: string) => `• ${i}`).join('\n')}`)
          .join('\n\n');
        await this.mentoria.updateCubo(tenantId, clienteId, { ...cuboActual, agentes: roadmapText });
      } catch (e) {
        this.logger.warn(`Error guardando roadmap en cubo: ${(e as any)?.message}`);
      }
    }

    return {
      hallazgos: hallazgosCreados,
      plan: accionesCreadas,
      resumen: parsed.resumen_ejecutivo ?? '',
      roi: parsed.roi_estimado ?? '',
      roadmap_5_fases: parsed.roadmap_5_fases ?? null,
    };
  }
}
