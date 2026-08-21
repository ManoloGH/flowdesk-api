import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../database/prisma.service';
import { MentoriaService } from './mentoria.service';

type CuboKey = 'contexto' | 'areas_procesos' | 'organigrama' | 'sistemas' | 'brechas' | 'agentes';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

const CUBO_KEYS = ['contexto', 'areas_procesos', 'organigrama', 'sistemas', 'brechas', 'agentes'] as const;

function buildSystemPrompt(
  empresa: string,
  cubo: Record<string, string>,
  sesionCtx?: { area?: string; interlocutor?: string; cargo?: string },
): string {
  const cuboState = Object.entries(cubo)
    .filter(([k, v]) => CUBO_KEYS.includes(k as any) && v?.trim())
    .map(([k, v]) => `[${k.toUpperCase()}]\n${v}`)
    .join('\n\n') || '(vacio - primera sesion)';

  const sesionLine = sesionCtx?.interlocutor
    ? `SESION ACTUAL: ${sesionCtx.interlocutor}${sesionCtx.cargo ? ` (${sesionCtx.cargo})` : ''}${sesionCtx.area ? ` — area: ${sesionCtx.area}` : ''}. Enfocate SOLO en esta area/persona.`
    : '';

  return `Eres el asistente de diagnostico del asesor de MentorIA Systems. Tu interlocutor es SIEMPRE el asesor, nunca el cliente.

El asesor conduce entrevistas con "${empresa}" y te comparte lo que le dijo el cliente.
${sesionLine ? '\n' + sesionLine : ''}
METODOLOGIA — documenta cada proceso en 3 etapas:
1. SOLICITUD: quien lo activa, por donde llega, que informacion dan.
2. PROCESO paso a paso: que data se genera, donde se registra, quien, desde donde trabaja, en que dispositivo.
3. ENTREGA: que se entrega, donde queda el registro, que exactamente se anota.

Estado actual del cubo:
${cuboState}

INSTRUCCIONES DE RESPUESTA:
1. Responde al asesor en maximo 150 palabras en espanol.
2. Confirma lo que ya quedo documentado y lo que falta.
3. Haz 2 preguntas concretas para completar el mapeo del proceso.
4. Si hay informacion NUEVA que guardar (no repetir lo que ya esta en el cubo), incluye AL FINAL bloques delta:
[CUBO:seccion]SOLO el contenido NUEVO a agregar — NO repitas lo que ya esta en el cubo[/CUBO]
Secciones: contexto | areas_procesos | organigrama | sistemas | brechas | agentes
IMPORTANTE: los bloques [CUBO] son ADITIVOS — el sistema concatena lo nuevo al final de la seccion existente. NO incluyas informacion que ya aparece en "Estado actual del cubo". Solo escribe lo que es nuevo en esta sesion.`;
}

function parseCuboBlocks(text: string): { cleanText: string; updates: Array<{ seccion: CuboKey; contenido: string }> } {
  const updates: Array<{ seccion: CuboKey; contenido: string }> = [];
  const regex = /\[CUBO:(\w+)\]([\s\S]*?)\[\/CUBO\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const seccion = match[1] as CuboKey;
    if (CUBO_KEYS.includes(seccion)) {
      updates.push({ seccion, contenido: match[2].trim() });
    }
  }
  const cleanText = text.replace(/\[CUBO:\w+\][\s\S]*?\[\/CUBO\]/g, '').trim();
  return { cleanText, updates };
}

@Injectable()
export class MentoriaSesionService {
  private readonly logger = new Logger(MentoriaSesionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mentoriaService: MentoriaService,
  ) {}

  async chatSesion(params: {
    tenantId: string;
    clienteId: string;
    message: string;
    sesionId?: string;
  }): Promise<{ text: string; cubo: Record<string, string>; sections_updated: string[] }> {
    const { tenantId, clienteId, message, sesionId } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key de Anthropic no configurada');

    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 55_000 });
    let currentCubo = (cliente.cubo as Record<string, string>) ?? {};

    // If sesionId provided, load history from that specific session
    let fullHistory: ChatEntry[];
    let sesionCtx: { area?: string; interlocutor?: string; cargo?: string } | undefined;
    if (sesionId) {
      const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
      const sesion = sesiones.find((s: any) => s.id === sesionId);
      fullHistory = (sesion?.mensajes ?? []) as ChatEntry[];
      if (sesion) {
        sesionCtx = { area: sesion.area, interlocutor: sesion.interlocutor, cargo: sesion.cargo };
      }
    } else {
      fullHistory = (cliente.chat_history as ChatEntry[] | null) ?? [];
    }

    // Last 8 messages (~4 exchanges), only non-empty content
    const recentHistory = fullHistory
      .slice(-8)
      .filter(m => m.content?.trim());

    const messages: Anthropic.MessageParam[] = [
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message },
    ];

    const systemPrompt = buildSystemPrompt(cliente.empresa, currentCubo, sesionCtx);
    let assistantText = '';
    const sectionsUpdated: string[] = [];

    try {
      // Single API call — no tool use loop
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages,
      });

      // Detect truncation — log warning when stop_reason is max_tokens
      const stopReason = (response as any).stop_reason;
      if (stopReason === 'max_tokens') {
        this.logger.warn(`chatSesion truncated at max_tokens for client ${clienteId}`);
      }

      const rawText = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
      const { cleanText, updates } = parseCuboBlocks(rawText);
      assistantText = cleanText;

      // Apply cubo updates — ADDITIVE: append new content to existing section
      for (const { seccion, contenido } of updates) {
        const existing = (currentCubo[seccion] ?? '').trim();
        currentCubo = { ...currentCubo, [seccion]: existing ? `${existing}\n\n${contenido}` : contenido };
        sectionsUpdated.push(seccion);
      }
      if (updates.length > 0) {
        try {
          await this.prisma.mentoriaCliente.update({
            where: { id: clienteId },
            data: { cubo: currentCubo },
          });
        } catch (e) {
          this.logger.warn(`Error guardando cubo: ${(e as any)?.message}`);
        }
      }
    } catch (aiError: any) {
      const isTimeout = aiError?.name === 'APIConnectionTimeoutError' || aiError?.name === 'APITimeoutError' || aiError?.code === 'ETIMEDOUT';
      assistantText = isTimeout
        ? 'El modelo tardó demasiado. Intenta de nuevo.'
        : `Error al contactar al modelo: ${aiError?.message ?? 'error desconocido'}`;
      this.logger.error(`Error Anthropic en chatSesion: ${aiError?.message}`);
    }

    // Save messages
    if (message.trim() || assistantText.trim()) {
      const newEntries: ChatEntry[] = [
        { role: 'user', content: message, ts: new Date().toISOString() },
        ...(assistantText.trim()
          ? [{ role: 'assistant' as const, content: assistantText, ts: new Date().toISOString() }]
          : []),
      ];

      if (sesionId) {
        // Save to the named session
        try {
          await this.mentoriaService.appendSesionDiagMessages(clienteId, sesionId, newEntries);
        } catch (e) {
          this.logger.warn(`Error guardando mensajes en sesión ${sesionId}: ${(e as any)?.message}`);
        }
      } else {
        // Legacy: save to flat chat_history
        const newHistory: ChatEntry[] = [...fullHistory, ...newEntries];
        try {
          await this.prisma.mentoriaCliente.update({
            where: { id: clienteId },
            data: { chat_history: newHistory as any },
          });
        } catch (e) {
          this.logger.warn(`Error guardando chat_history: ${(e as any)?.message}`);
        }
      }
    }

    return { text: assistantText, cubo: currentCubo, sections_updated: sectionsUpdated };
  }

  // ── GENERACIÓN DE CUESTIONARIO PERSONALIZADO ────────────────────────────────

  async generarCuestionario(params: {
    tenantId: string;
    clienteId: string;
    sesionId?: string;
    rolDestino: 'gerente' | 'operador';
    area: string;
  }): Promise<{ id: string; titulo: string; rol_destino: string; area: string; preguntas: any[]; generado_at: string }> {
    const { tenantId, clienteId, sesionId, rolDestino, area } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key de Anthropic no configurada');

    const cubo = (cliente.cubo ?? {}) as Record<string, string>;
    // Only include known cubo sections (exclude internal fields like __cuestionarios_globales)
    const cuboText = Object.entries(cubo)
      .filter(([k, v]) => CUBO_KEYS.includes(k as any) && v?.trim())
      .map(([k, v]) => `[${k.toUpperCase()}]\n${v}`)
      .join('\n\n') || '(sin información en el cubo aún)';

    // Session context is optional
    let sesionContexto = '';
    let interlocutorLabel = 'el equipo directivo';
    if (sesionId) {
      const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
      const sesion = sesiones.find((s: any) => s.id === sesionId);
      if (sesion) {
        interlocutorLabel = sesion.interlocutor ?? interlocutorLabel;
        const sesionText = ((sesion.mensajes ?? []) as any[])
          .map((m: any) => `${m.role === 'user' ? 'Asesor' : 'IA'}: ${m.content}`)
          .join('\n');
        if (sesionText.trim()) {
          sesionContexto = `\nSESIÓN CON ${(sesion.cargo ?? 'DIRECTIVO').toUpperCase()} — ${sesion.interlocutor}:\n${sesionText}`;
        }
      }
    }

    const rolLabel = rolDestino === 'gerente' ? 'GERENTES' : 'OPERADORES';

    const prompt = `Eres experto en diagnóstico organizacional. Basándote en:

CONTEXTO DEL CLIENTE (${cliente.empresa}):
${cuboText}
${sesionContexto}

Genera un cuestionario personalizado para los ${rolLabel} del área de ${area} en ${cliente.empresa}.

INSTRUCCIONES — genera un cuestionario estructurado por secciones para ${rolLabel} del área de ${area}:

SECCIÓN 1 — Perfil del área: herramientas y sistemas que usa el área, número de personas, roles principales.

SECCIÓN 2 — Procesos principales: identifica al menos 3 procesos clave del área y documenta cada uno con EXACTAMENTE 3 preguntas usando el campo "seccion" con el formato "<nombre del proceso> — SOLICITUD", "<nombre del proceso> — PROCESO", "<nombre del proceso> — ENTREGA":
  - <Proceso> — SOLICITUD: ¿Quién activa el proceso? ¿Por qué canal llega (WhatsApp, email, verbal, sistema)? ¿Qué información exacta proporciona quien lo solicita? ¿Con qué frecuencia ocurre?
  - <Proceso> — PROCESO: ¿Qué pasos ocurren desde que entra la solicitud hasta que se resuelve? ¿Qué datos se generan en cada paso? ¿Dónde se registran (sistema, Excel, papel, WhatsApp)? ¿Quién los registra y desde qué dispositivo? ¿Qué decisiones intermedias se toman y quién las toma?
  - <Proceso> — ENTREGA: ¿Qué se entrega al finalizar (documento, notificación, registro en sistema)? ¿Dónde queda el registro final? ¿Quién confirma que el proceso terminó correctamente? ¿Existe un SOP o instructivo escrito?
  Ejemplo de seccion para un proceso de cotización: "Cotización a cliente — SOLICITUD", "Cotización a cliente — PROCESO", "Cotización a cliente — ENTREGA".

SECCIÓN 3 — Flujos con otras áreas: ¿Qué información recibe de otras áreas y por qué medio? ¿Qué información entrega a otras áreas?

SECCIÓN 4 — Documentos y archivos clave: ¿Qué documentos, archivos o reportes genera o usa el área? ¿Dónde viven? ¿Quién los crea y quién los consulta?

SECCIÓN 5 — Decisiones y reglas de negocio: ¿Qué decisiones importantes toma el área? ¿Bajo qué condiciones? ¿Requieren autorización?

SECCIÓN 6 — Indicadores y KPIs: ¿Cómo mide su desempeño el área? ¿A quién reporta y con qué frecuencia?

SECCIÓN 7 — Problemas y oportunidades: ¿Cuáles son los 3 principales cuellos de botella? ¿Qué proceso quita más tiempo? ¿Qué errores ocurren con más frecuencia?

Devuelve SOLO JSON válido (sin markdown, sin texto fuera del JSON):
{
  "preguntas": [
    {
      "seccion": "nombre del proceso (ej: Cotización a cliente, Compra de materiales)",
      "pregunta": "pregunta específica y clara",
      "contexto_empresa": "por qué esta pregunta es relevante para ${cliente.empresa} (1 frase corta)"
    }
  ]
}

Genera entre 14 y 18 preguntas, distribuidas entre las 7 secciones (2-3 por sección). Sé específico con ${cliente.empresa} y ${area}.`;

    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 25_000 });
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      system: 'Generates organizational diagnostic questionnaires. Respond ONLY with valid JSON. No markdown, no explanation.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
    this.logger.debug(`Cuestionario raw response (${text.length} chars): ${text.substring(0, 200)}`);
    let preguntas: any[] = [];
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`Sin bloque JSON en respuesta (${text.length} chars)`);
      const parsed = JSON.parse(match[0]);
      preguntas = parsed.preguntas ?? [];
      if (preguntas.length === 0) throw new Error('JSON válido pero sin preguntas');
    } catch (parseErr: any) {
      this.logger.error(`Error parseando cuestionario: ${parseErr.message} | texto: ${text.substring(0, 500)}`);
      throw new Error('Error al generar el cuestionario. Intenta de nuevo.');
    }

    const cuestionario = {
      id: `cq-${Date.now()}`,
      titulo: `Cuestionario ${rolLabel.charAt(0) + rolLabel.slice(1).toLowerCase()} — ${area}`,
      rol_destino: rolDestino,
      area,
      preguntas,
      generado_at: new Date().toISOString(),
    };

    // Save to session if sesionId provided, otherwise save to client-level list
    if (sesionId) {
      try {
        await this.mentoriaService.saveCuestionarioGenerado(clienteId, sesionId, cuestionario);
      } catch (e) {
        this.logger.warn(`Error guardando cuestionario en sesión: ${(e as any)?.message}`);
      }
    } else {
      try {
        await this.mentoriaService.saveCuestionarioGlobal(clienteId, cuestionario);
      } catch (e) {
        this.logger.warn(`Error guardando cuestionario global: ${(e as any)?.message}`);
      }
    }

    return cuestionario;
  }

  async sugerirSiguientesSesiones(params: {
    tenantId: string;
    clienteId: string;
    sesionId: string;
  }): Promise<Array<{ titulo: string; tipo: string; interlocutor: string; cargo: string; area: string }>> {
    const { tenantId, clienteId, sesionId } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
    const sesion = sesiones.find((s: any) => s.id === sesionId);
    if (!sesion) throw new Error('Sesión no encontrada');

    const cubo = (cliente.cubo ?? {}) as Record<string, string>;
    const orgText = cubo.organigrama ?? '';
    const sesionText = ((sesion.mensajes ?? []) as any[])
      .map((m: any) => `${m.role === 'user' ? 'Asesor' : 'IA'}: ${m.content}`)
      .join('\n');

    const NEXT_ROLE: Record<string, string> = { dg: 'director', director: 'gerente', gerente: 'operador' };
    const nextRole = NEXT_ROLE[sesion.tipo as string] ?? 'gerente';
    const nextLabel = nextRole === 'director' ? 'Directores de área' : nextRole === 'gerente' ? 'Gerentes' : 'Operadores';

    const prompt = `Eres experto en diagnóstico organizacional de empresas.

SESIÓN ANALIZADA — ${sesion.interlocutor ?? 'Interlocutor'} (${sesion.cargo ?? sesion.tipo}):
${sesionText || '(sesión sin mensajes registrados)'}

ORGANIGRAMA CONOCIDO:
${orgText || '(sin datos de organigrama aún)'}

EMPRESA: ${cliente.empresa}

Identifica quiénes son los ${nextLabel} que deberían ser entrevistados a continuación, basándote en lo que mencionó ${sesion.interlocutor ?? 'el interlocutor'} sobre su equipo y la estructura de la empresa.

Devuelve SOLO JSON válido:
{
  "sesiones_sugeridas": [
    {
      "interlocutor": "nombre de la persona (o 'Por definir' si no se mencionó)",
      "cargo": "cargo específico",
      "area": "área o departamento que maneja",
      "tipo": "${nextRole}",
      "titulo": "Sesión ${nextRole === 'director' ? 'Director' : nextRole === 'gerente' ? 'Gerente' : 'Operador'} — cargo o área"
    }
  ],
  "notas": "qué información falta para identificar mejor al equipo"
}

Máximo 8 sugerencias. Si no hay información suficiente, sugiere al menos 1 sesión genérica por área mencionada.`;

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key no configurada');

    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 30_000 });
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: 'Organizational analyst. Respond ONLY with valid JSON. No markdown.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
    try {
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text);
      return parsed.sesiones_sugeridas ?? [];
    } catch {
      this.logger.warn(`Error parseando sugerencias: ${text.substring(0, 200)}`);
      return [];
    }
  }

  // ── REVISIÓN FINAL DEL CUBO ──────────────────────────────────────────────────

  async revisarCubo(params: { tenantId: string; clienteId: string }): Promise<{
    resumen: string;
    huecos: Array<{ area: string; descripcion: string; prioridad: 'critico' | 'importante' | 'menor' }>;
    confirmaciones: string[];
    entregables: Array<{ id: string; nombre: string; estado: 'listo' | 'incompleto' | 'sin_datos'; faltante?: string }>;
    preguntas_finales: Array<{ seccion: string; pregunta: string }>;
  }> {
    const { tenantId, clienteId } = params;

    const cliente = await this.prisma.mentoriaCliente.findFirst({
      where: { id: clienteId, tenant_id: tenantId },
    });
    if (!cliente) throw new Error('Cliente no encontrado');

    const cubo = (cliente.cubo ?? {}) as Record<string, string>;
    const cuboText = CUBO_KEYS
      .filter(k => cubo[k]?.trim())
      .map(k => `[${k.toUpperCase()}]\n${cubo[k]}`)
      .join('\n\n') || '(vacío)';

    const sesiones = ((cliente as any).sesiones_diagnostico ?? []) as any[];
    const sesionesText = sesiones.length
      ? sesiones.map((s: any) => {
          const msgs = ((s.mensajes ?? []) as any[])
            .slice(-10)
            .map((m: any) => `${m.role === 'user' ? 'Asesor' : 'IA'}: ${m.content}`)
            .join('\n');
          return `SESIÓN: ${s.titulo} (${s.tipo})\n${msgs || '(sin mensajes)'}`;
        }).join('\n\n---\n\n')
      : '(ninguna sesión registrada)';

    const prompt = `Eres experto en diagnóstico organizacional. Revisas el cubo de información de ${cliente.empresa} ANTES de generar los entregables finales para detectar huecos y lo que falta confirmar.

CUBO DE INFORMACIÓN:
${cuboText}

SESIONES REALIZADAS:
${sesionesText}

ENTREGABLES QUE SE GENERARÁN:
1. flujo_asis — Mapa de Procesos AS-IS (necesita: areas_procesos, brechas, sistemas)
2. org_actual — Organigrama actual (necesita: organigrama, contexto)
3. flujo_tobe — Flujo TO-BE (necesita: agentes, areas_procesos)
4. org_nuevo — Organigrama nuevo + costo (necesita: agentes, organigrama)
5. propuesta — Propuesta agentes IA (necesita: agentes, brechas, contexto)
6. roadmap — Roadmap 24 meses (necesita: todos los campos)

Devuelve SOLO JSON válido:
{
  "resumen": "párrafo de 2-3 oraciones sobre el estado del diagnóstico y qué tan listo está para entregar",
  "huecos": [
    { "area": "nombre del área o sección", "descripcion": "qué falta documentar exactamente", "prioridad": "critico | importante | menor" }
  ],
  "confirmaciones": [
    "dato o acuerdo que el asesor debe verificar con el cliente antes de la entrega (frases cortas, accionables)"
  ],
  "entregables": [
    { "id": "flujo_asis | org_actual | flujo_tobe | org_nuevo | propuesta | roadmap", "nombre": "nombre completo", "estado": "listo | incompleto | sin_datos", "faltante": "qué falta (solo si no está listo)" }
  ],
  "preguntas_finales": [
    { "seccion": "cubo key (contexto | areas_procesos | organigrama | sistemas | brechas | agentes)", "pregunta": "pregunta concreta para llenar el hueco" }
  ]
}`;

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key no configurada');
    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 45_000 });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: 'Organizational diagnosis reviewer. Respond ONLY with valid JSON. No markdown.',
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Sin JSON en respuesta de revisión');
    return JSON.parse(match[0]);
  }

  // ── CHAT PÚBLICO (sin auth, para entrevistas a gerentes/operadores) ──────────

  async chatSesionPublico(params: {
    token: string;
    mensaje: string;
  }): Promise<{ text: string; cubo: Record<string, string>; sections_updated: string[]; completada: boolean }> {
    const { token, mensaje } = params;

    // Busca la sesión por token en todos los clientes
    const clientes = await this.prisma.mentoriaCliente.findMany({
      select: { id: true, empresa: true, cubo: true, sesiones_diagnostico: true },
    });

    let clienteId: string | null = null;
    let sesionId: string | null = null;
    let empresa = '';
    let sesionData: any = null;

    for (const c of clientes) {
      const sesiones: any[] = ((c.sesiones_diagnostico ?? []) as any[]);
      const sesion = sesiones.find((s: any) => s.token_publico === token);
      if (sesion) {
        clienteId = c.id;
        sesionId = sesion.id;
        empresa = c.empresa;
        sesionData = sesion;
        break;
      }
    }

    if (!clienteId || !sesionId || !sesionData) throw new Error('Sesión no encontrada o token inválido');

    const cliente = await this.prisma.mentoriaCliente.findUnique({ where: { id: clienteId } });
    if (!cliente) throw new Error('Cliente no encontrado');

    const cubo = (cliente.cubo as Record<string, string>) ?? {};
    const cuboState = CUBO_KEYS
      .filter(k => cubo[k]?.trim())
      .map(k => `[${k.toUpperCase()}]\n${cubo[k]}`)
      .join('\n\n') || '(sin datos aún)';

    const intercambiosPrevios = fullHistory.filter((m: any) => m.role === 'user').length;
    const suficientesIntercambios = intercambiosPrevios >= 8;

    const systemPrompt = `Eres un asistente de diagnóstico organizacional. Estás entrevistando a ${sesionData.interlocutor ?? 'un colaborador'} (${sesionData.cargo ?? 'cargo'}) del área de ${sesionData.area ?? 'la empresa'} en ${empresa}.

Tu objetivo: mapear los procesos del área haciendo preguntas conversacionales, una sección a la vez.

Para cada proceso importante que mencionen, pregunta sobre las 3 etapas:
- SOLICITUD: ¿quién activa el proceso y por qué canal?
- PROCESO: ¿qué pasos se siguen? ¿dónde registran cada cosa?
- ENTREGA: ¿qué se entrega al final? ¿queda registro en algún sistema?

Cuando documentes cada proceso, actualiza el cubo AL FINAL de tu mensaje:
[CUBO:areas_procesos]contenido COMPLETO actualizado del área — incluye lo ya recopilado más lo nuevo[/CUBO]

También puedes actualizar otras secciones si el tema sale:
[CUBO:organigrama]contenido[/CUBO]
[CUBO:sistemas]contenido[/CUBO]
[CUBO:brechas]contenido[/CUBO]

Instrucciones de conversación:
- Habla directamente con ${sesionData.interlocutor ?? 'la persona'}, sé amable y conversacional
- Haz máximo 2 preguntas a la vez
- Haz follow-up antes de cambiar de tema
- No repitas preguntas ya respondidas
- Responde en español, máximo 150 palabras${suficientesIntercambios ? `

CONDICIÓN DE CIERRE — ya llevamos ${intercambiosPrevios} intercambios:
Cuando consideres que ya documentaste al menos 3 procesos completos (SOLICITUD+PROCESO+ENTREGA cada uno), los flujos con otras áreas, los sistemas usados y los principales problemas del área, CIERRA la entrevista con un mensaje de despedida cálido que:
1. Agradezca el tiempo de ${sesionData.interlocutor ?? 'la persona'} y mencione qué se logró documentar
2. Informe que la información quedará guardada en FlowDesk para el diagnóstico
3. Indique que el consultor les compartirá los resultados pronto
Después de ese texto, incluye en una línea separada: [ENTREVISTA_COMPLETADA]
Si aún faltan procesos o información clave, continúa la entrevista normalmente.` : ''}

Información ya recopilada:
${cuboState}`;

    const fullHistory: ChatEntry[] = (sesionData.mensajes ?? []) as ChatEntry[];
    const recentHistory = fullHistory.slice(-8).filter(m => m.content?.trim());

    const messages: Anthropic.MessageParam[] = [
      ...recentHistory.map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: mensaje },
    ];

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error('API key no configurada');
    const anthropic = new Anthropic({ apiKey: anthropicKey, timeout: 55_000 });

    let assistantText = '';
    const sectionsUpdated: string[] = [];
    let currentCubo = { ...cubo };
    let entrevistaCompletada = false;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: systemPrompt,
        messages,
      });

      let rawText = (response.content.find((b: any) => b.type === 'text') as any)?.text ?? '';

      // Detectar marcador de cierre
      if (rawText.includes('[ENTREVISTA_COMPLETADA]')) {
        entrevistaCompletada = true;
        rawText = rawText.replace(/\[ENTREVISTA_COMPLETADA\]/g, '').trim();
      }

      const { cleanText, updates } = parseCuboBlocks(rawText);
      assistantText = cleanText;

      for (const { seccion, contenido } of updates) {
        currentCubo = { ...currentCubo, [seccion]: contenido };
        sectionsUpdated.push(seccion);
      }
      if (updates.length > 0) {
        await this.prisma.mentoriaCliente.update({
          where: { id: clienteId },
          data: { cubo: currentCubo },
        });
      }

      // Marcar sesión como completada
      if (entrevistaCompletada) {
        await this.mentoriaService.marcarSesionCompletada(clienteId, sesionId);
      }
    } catch (aiError: any) {
      const isTimeout = aiError?.name === 'APIConnectionTimeoutError' || aiError?.name === 'APITimeoutError';
      assistantText = isTimeout
        ? 'Tardé demasiado en responder. Por favor intenta de nuevo.'
        : 'Ocurrió un error. Por favor intenta de nuevo.';
    }

    // Guardar mensajes en la sesión
    if (mensaje.trim() || assistantText.trim()) {
      const newEntries: ChatEntry[] = [
        { role: 'user', content: mensaje, ts: new Date().toISOString() },
        ...(assistantText.trim() ? [{ role: 'assistant' as const, content: assistantText, ts: new Date().toISOString() }] : []),
      ];
      try {
        await this.mentoriaService.appendSesionDiagMessages(clienteId, sesionId, newEntries);
      } catch {}
    }

    return { text: assistantText, cubo: currentCubo, sections_updated: sectionsUpdated, completada: entrevistaCompletada };
  }
}
