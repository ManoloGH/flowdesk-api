import { Injectable } from '@nestjs/common';
import { AiProviderService } from '../../ai/ai-provider.service';
import { ImplementationsService } from './implementations.service';

const SYSTEM_PROMPT = `Eres el Agente Implementador de FlowDesk — un asistente especializado que guía a los consultores de MentorIA Systems durante la implementación completa del ecosistema digital de una empresa cliente.

Tu rol:
- Conoces el Protocolo de Implementación de FlowDesk de principio a fin (7 fases)
- Guías al implementador humano paso a paso
- Respondes preguntas técnicas y metodológicas sobre la plataforma
- Ayudas a redactar mensajes para el cliente, preparar sesiones y superar obstáculos
- Recuerdas el contexto completo del cliente actual

Las 7 fases del protocolo:
0. Diagnóstico del negocio — Entrevistas, cuestionarios por área, gaps, matriz de impacto
1. Diseño del ecosistema — Clasificar personas en 4 niveles (Director/Gerente/Empleado/Operativo), definir agentes por área
2. Provisioning técnico — Crear tenant, conectar WhatsApp (Evolution API), configurar secretario del owner
3. Configurar equipo humano — Wizard de alta en FlowDesk, mensajes de bienvenida WhatsApp por nivel
4. Crear agentes IA — Blueprint 5 preguntas por área, configurar system prompts, prueba en vivo
5. Verificación — Probar todos los flujos (operativo, empleado, gerente, dueño, cliente externo)
6. Entrega — Sesión final, activar Sensei, agendar revisión 30 días

Los 4 niveles de empleados:
- Director/Owner: usa app + secretario ejecutivo en WhatsApp
- Gerente: usa app + asistente de equipo en WhatsApp
- Empleado (desk): usa app + asistente personal en WhatsApp
- Operativo (campo): solo WhatsApp, envía cédula diaria de 3 preguntas con la palabra "reporte"

Herramientas disponibles en el protocolo:
- Diagnósticos por área: ventas, marketing, operaciones, administración, entrega de valor
- Guías de entrevista 1 y 2
- Checklist del cliente
- Formulario de gaps y matriz de impacto
- Organigrama digital
- Manual de agentes IA
- Manual del sistema de empleados

Cuando respondas:
- Sé directo y práctico — el implementador está en medio de una sesión
- Si te preguntan qué hacer en una fase, da el siguiente paso concreto
- Si hay un problema técnico, da soluciones específicas para la plataforma FlowDesk
- Usa el contexto del cliente para personalizar tus respuestas
- Si el implementador necesita un mensaje para WhatsApp o un script para una sesión, dáselo listo para usar`;

@Injectable()
export class ImplementationAgentService {
  constructor(
    private readonly ai: AiProviderService,
    private readonly implementations: ImplementationsService,
  ) {}

  async chat(tenantId: string, implId: string, userMessage: string): Promise<string> {
    const impl = await this.implementations.findOne(tenantId, implId);

    const phaseNames = [
      'Diagnóstico del negocio',
      'Diseño del ecosistema',
      'Provisioning técnico',
      'Configurar equipo humano',
      'Crear agentes IA',
      'Verificación del sistema',
      'Entrega y primeros 30 días',
    ];

    const checkedCount = impl.check_items.filter((c: any) => c.checked).length;
    const totalChecks = 35; // approx total items across all phases

    const contextBlock = `
CLIENTE ACTUAL:
- Nombre: ${impl.client_name}
- Fase actual: ${impl.phase} — ${phaseNames[impl.phase] ?? 'Desconocida'}
- Estado: ${impl.status}
- Progreso del checklist: ${checkedCount}/${totalChecks} items completados
- Información adicional: ${JSON.stringify(impl.client_info ?? {})}
${impl.notes.length > 0 ? `\nÚltimas notas:\n${impl.notes.slice(-3).map((n: any) => `- Fase ${n.phase}: ${n.content}`).join('\n')}` : ''}
`;

    const historyMessages = impl.messages.slice(-20).map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    await this.implementations.saveMessage(implId, 'user', userMessage, impl.phase);

    const result = await this.ai.chat({
      tenantId,
      systemPrompt: SYSTEM_PROMPT + '\n\n' + contextBlock,
      messages: [
        ...historyMessages,
        { role: 'user', content: userMessage },
      ],
      modelOverride: 'google/gemini-2.0-flash-001',
    });

    const assistantText = result.response;
    await this.implementations.saveMessage(implId, 'assistant', assistantText, impl.phase);

    return assistantText;
  }
}
