import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';

type AgenteKey = 'planificacion' | 'cubo' | 'entregables';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

const ENTREGABLES_REQUERIDOS = [
  { id: 'flujo_asis',  titulo: 'Mapa de Procesos AS-IS',      necesita: ['areas_procesos', 'brechas', 'sistemas'] },
  { id: 'org_actual',  titulo: 'Organigrama actual',           necesita: ['organigrama', 'contexto'] },
  { id: 'flujo_tobe',  titulo: 'Flujo TO-BE por fases',        necesita: ['agentes', 'areas_procesos'] },
  { id: 'org_nuevo',   titulo: 'Organigrama nuevo + costo',    necesita: ['agentes', 'organigrama'] },
  { id: 'propuesta',   titulo: 'Propuesta agentes IA',         necesita: ['agentes', 'brechas', 'contexto'] },
  { id: 'roadmap',     titulo: 'Roadmap 24 meses',             necesita: ['contexto', 'agentes', 'areas_procesos', 'brechas', 'organigrama', 'sistemas'] },
];

function buildPlanificacionPrompt(empresa: string, cubo: any, sesiones: any[]): string {
  const orgTxt = cubo?.organigrama ?? '(sin datos aún)';
  const cuboResumen = ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes']
    .filter(k => cubo?.[k]?.trim())
    .map(k => `[${k.toUpperCase()}]\n${cubo[k]}`)
    .join('\n\n') || '(cubo vacío)';

  const sesionesTxt = sesiones.length
    ? sesiones.map(s => {
        const msgs = (s.mensajes ?? []).length;
        const cqs = (s.cuestionarios_generados ?? []).length;
        return `• ${s.titulo} (${s.tipo}) — ${s.interlocutor ?? '?'}, ${s.area ?? '?'} — ${msgs} intercambios, ${cqs} cuestionarios — ${s.completada ? '✓ completada' : 'en progreso'}`;
      }).join('\n')
    : '(ninguna sesión creada aún)';

  return `Eres el Agente de Planificación de entrevistas y cuestionarios para el diagnóstico de "${empresa}".

SESIONES Y CUESTIONARIOS ACTUALES:
${sesionesTxt}

ORGANIGRAMA CONOCIDO:
${orgTxt}

CUBO DE INFORMACIÓN ACTUAL:
${cuboResumen}

TU ROL:
1. Ayuda al asesor a planear QUÉ entrevistas y cuestionarios hacer y en qué orden.
2. Cuando en una sesión surja un tema que involucra otra área, señálalo explícitamente: "Este punto de [Área A] debe preguntarse también en [Área B] — agrega esta pregunta a esa sesión."
3. Detecta preguntas que se entrelazan entre áreas: si Ventas menciona que Crédito les frena pedidos, en la sesión de Crédito debes preguntar exactamente sobre ese punto.
4. Lleva un estado mental de qué áreas están cubiertas y cuáles faltan.
5. Avisa cuando la cobertura sea suficiente para avanzar al análisis del cubo.

INSTRUCCIONES:
- Responde en español, máximo 200 palabras.
- Sé concreto: checklists, estados claros, preguntas específicas a agregar.
- No repitas sesiones ya completadas; enfócate en lo pendiente.
- Si el asesor dice que terminó una sesión, actualiza tu estado mental y sugiere qué sigue.`;
}

function buildCuboPrompt(empresa: string, cubo: any, sesiones: any[]): string {
  const cuboCompleto = ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes']
    .map(k => `[${k.toUpperCase()}]\n${cubo?.[k]?.trim() || '(vacío)'}`)
    .join('\n\n');

  const entregablesMap = ENTREGABLES_REQUERIDOS.map(e => {
    const faltantes = e.necesita.filter(k => !cubo?.[k]?.trim());
    return `• ${e.titulo}: ${faltantes.length === 0 ? '✓ datos completos' : `FALTAN: ${faltantes.join(', ')}`}`;
  }).join('\n');

  return `Eres el Agente de Análisis del Cubo de Información para "${empresa}".

CUBO COMPLETO:
${cuboCompleto}

ESTADO DE DATOS POR ENTREGABLE:
${entregablesMap}

TU ROL:
1. Analiza la información del cubo y detecta CONFLICTOS entre áreas: cuando dos áreas describen el mismo proceso de formas distintas o contradictorias.
2. Detecta ENCIMES: procesos que dos áreas creen que son responsabilidad de la otra, o que ambas hacen sin coordinación.
3. Detecta RUPTURAS: puntos donde el flujo de información se corta (Área A entrega X, pero Área B dice que no recibe nada).
4. Señala HUECOS CRÍTICOS: información que falta y que bloquea la generación de uno o más entregables.
5. Prioriza hallazgos por impacto: ¿qué necesita resolverse ANTES de generar entregables?

INSTRUCCIONES:
- Responde en español, máximo 200 palabras.
- Usa etiquetas: [CONFLICTO], [ENCIME], [RUPTURA], [HUECO] para que el asesor los identifique rápido.
- Sé específico: "Ventas dice X, Operaciones dice Y — alguien está equivocado o hay un malentendido."
- Cuando el asesor resuelva un hueco, confirma y busca el siguiente más crítico.`;
}

function buildEntregablesPrompt(empresa: string, cubo: any, historialCorrecciones: string): string {
  const cuboCompleto = ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes']
    .map(k => `[${k.toUpperCase()}]\n${cubo?.[k]?.trim() || '(vacío)'}`)
    .join('\n\n');

  return `Eres el Agente de Entregables para el diagnóstico de "${empresa}".

CUBO DE INFORMACIÓN:
${cuboCompleto}

HISTORIAL DE CORRECCIONES Y APRENDIZAJES:
${historialCorrecciones || '(primera iteración — sin correcciones previas)'}

TU ROL:
1. Ayuda al asesor a generar, revisar e iterar cada uno de los 6 entregables del diagnóstico.
2. Cuando el asesor indique correcciones del cliente, incorpóralas en la siguiente versión Y revisa si el mismo problema existe en otros entregables (mantén consistencia).
3. Aprende del patrón de correcciones: si el cliente siempre pide más detalle en costos, anticípalo en el siguiente entregable; si prefiere lenguaje ejecutivo sobre técnico, ajusta el tono.
4. Cada entregable sigue el ciclo: BORRADOR → REVISIÓN CON CLIENTE → CORRECCIONES → VERSIÓN FINAL. Guía al asesor en cada paso.
5. El organigrama nuevo debe ser consistente con la propuesta de agentes; el roadmap debe derivarse de los flujos TO-BE. Mantén coherencia entre entregables.

ENTREGABLES DEL DIAGNÓSTICO:
1. Mapa de Procesos AS-IS — estado actual con brechas señaladas
2. Organigrama actual — roles, tareas, herramientas
3. Flujo TO-BE — procesos optimizados con IA en cada etapa
4. Organigrama nuevo + costo — ahorro de headcount con agentes IA
5. Propuesta agentes IA — descripción, ROI y especificaciones
6. Roadmap 24 meses — fases e hitos

INSTRUCCIONES:
- Responde en español, máximo 250 palabras.
- Cuando el asesor diga "corrección: X", confírmala, aplícala y pregunta si hay más antes de pasar a la siguiente versión.
- Registra cada corrección como aprendizaje para este cliente: "Para este cliente, X significa Y."
- Al iniciar un nuevo entregable, resume los aprendizajes aplicables del ciclo anterior.`;
}

@Injectable()
export class MentoriaAgentesService {
  private readonly logger = new Logger(MentoriaAgentesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async chat(params: {
    tenantId: string;
    clienteId: string;
    agente: AgenteKey;
    mensaje: string;
  }): Promise<{ text: string; agente: AgenteKey }> {
    const { tenantId, clienteId, agente, mensaje } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key de Anthropic no configurada');

    const cubo = (cliente.cubo as any) ?? {};
    const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
    const chatsAgente = ((cliente as any).chats_agente ?? {}) as Record<AgenteKey, ChatEntry[]>;
    const history: ChatEntry[] = chatsAgente[agente] ?? [];

    // Historial de correcciones para A3 — extraído del propio chat de entregables
    const historialCorrecciones = agente === 'entregables'
      ? history
          .filter(m => m.role === 'user' && m.content.toLowerCase().includes('correc'))
          .map(m => `• ${m.content}`)
          .join('\n') || ''
      : '';

    let systemPrompt: string;
    if (agente === 'planificacion') systemPrompt = buildPlanificacionPrompt(cliente.empresa, cubo, sesiones);
    else if (agente === 'cubo') systemPrompt = buildCuboPrompt(cliente.empresa, cubo, sesiones);
    else systemPrompt = buildEntregablesPrompt(cliente.empresa, cubo, historialCorrecciones);

    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 45_000 });
    const recentHistory = history.slice(-10).filter(m => m.content?.trim());

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [
        ...recentHistory.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: mensaje },
      ],
    });

    const assistantText = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';

    // Guardar historial
    const newHistory: ChatEntry[] = [
      ...history,
      { role: 'user', content: mensaje, ts: new Date().toISOString() },
      { role: 'assistant', content: assistantText, ts: new Date().toISOString() },
    ];
    const updatedChats = { ...chatsAgente, [agente]: newHistory };

    try {
      await this.prisma.mentoriaCliente.update({
        where: { id: clienteId },
        data: { chats_agente: updatedChats as any },
      });
    } catch (e) {
      this.logger.warn(`Error guardando chat agente ${agente}: ${(e as any)?.message}`);
    }

    return { text: assistantText, agente };
  }

  async getHistory(tenantId: string, clienteId: string, agente: AgenteKey): Promise<ChatEntry[]> {
    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
      select: { chats_agente: true },
    });
    const chats = ((cliente?.chats_agente as any) ?? {}) as Record<AgenteKey, ChatEntry[]>;
    return chats[agente] ?? [];
  }

  async clearHistory(tenantId: string, clienteId: string, agente: AgenteKey): Promise<void> {
    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
      select: { chats_agente: true },
    });
    const chats = ((cliente?.chats_agente as any) ?? {}) as Record<AgenteKey, ChatEntry[]>;
    await this.prisma.mentoriaCliente.update({
      where: { id: clienteId },
      data: { chats_agente: { ...chats, [agente]: [] } as any },
    });
  }
}
