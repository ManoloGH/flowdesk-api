import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AiProviderService } from '../../ai/ai-provider.service';
import {
  CreateSenseiProjectDto, UpdateSenseiProjectDto,
  AddEvidenceDto, SendMessageDto, RunIterationDto,
  IterationFeedbackDto, CertifySkillDto,
} from './dto/sensei.dto';

// Preguntas base que Sensei hace siempre en la fase base_questions
const BASE_QUESTIONS = [
  '¿Qué necesitas para poder empezar esta tarea? ¿Qué información o materiales requieres?',
  '¿Cómo sabes que el resultado quedó bien? ¿Cuál es tu criterio de éxito?',
  '¿Qué errores comete la gente que hace esta tarea por primera vez?',
  '¿Qué partes del proceso siempre son iguales? ¿Qué partes cambian cada vez?',
  '¿Hay casos especiales o excepciones que debes manejar diferente?',
  '¿Quién revisa el resultado antes de que llegue al cliente o destinatario final?',
  '¿Qué herramientas o sistemas usas para hacer esta tarea?',
  '¿Hay algo que NUNCA debes hacer o incluir en este entregable?',
];

function buildSystemPrompt(project: any, phase: string): string {
  return `You are Agente Sensei, an AI specialist that trains digital agents to replace human tasks inside companies.

Your current assignment:
- Skill being developed: "${project.name}"
- Who does this task today: ${project.who_does_it ?? 'Not specified yet'}
- Output type: ${project.output_type}
- Current phase: ${phase}
- Target agent that will use this skill: ${project.target_agent ?? 'To be defined'}

Your mission: Extract the complete, precise knowledge needed so a digital agent can perform this task EXACTLY as the human does today — not approximately, but exactly. Quality is the only driver.

Phase behavior:
- intake: Collect basic task information. Ask about name, who does it, output, frequency.
- base_questions: Ask the 8 base questions one by one. Be conversational, not like a form.
- analysis: You have analyzed all evidence. Share your findings and ask follow-up questions about specific gaps.
- deep_questions: Ask targeted questions based on gaps found in evidence analysis.
- draft: Explain the generated skill. Ask for a test case to run.
- iterations: Present iteration results. Collect feedback. Refine. Be specific about what changed.
- certified: Congratulate. Explain next steps for deployment.

Tone: Professional, warm, patient. This is a training program, not a quick form.
Always respond in Spanish.`;
}

@Injectable()
export class SenseiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiProviderService,
  ) {}

  async listProjects(tenantId: string) {
    return this.prisma.senseiSkillProject.findMany({
      where: { tenant_id: tenantId },
      include: {
        _count: { select: { evidence: true, iterations: true } },
        deliverable_skill: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getProject(tenantId: string, projectId: string) {
    const project = await this.prisma.senseiSkillProject.findFirst({
      where: { id: projectId, tenant_id: tenantId },
      include: {
        evidence: { orderBy: { created_at: 'asc' } },
        messages: { orderBy: { created_at: 'asc' } },
        iterations: { orderBy: { number: 'asc' } },
        deliverable_skill: { select: { id: true, name: true, status: true } },
      },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado');
    return project;
  }

  async createProject(tenantId: string, userId: string, dto: CreateSenseiProjectDto) {
    return this.prisma.senseiSkillProject.create({
      data: {
        tenant_id: tenantId,
        created_by: userId,
        name: dto.name,
        description: dto.description,
        who_does_it: dto.who_does_it,
        frequency: dto.frequency,
        output_type: dto.output_type ?? 'document',
        task_type: dto.task_type ?? 'document',
        target_agent: dto.target_agent,
        max_iterations: dto.max_iterations ?? 10,
        phase: 'intake',
      },
    });
  }

  async updateProject(tenantId: string, projectId: string, dto: UpdateSenseiProjectDto) {
    await this.getProject(tenantId, projectId);
    return this.prisma.senseiSkillProject.update({
      where: { id: projectId },
      data: dto,
    });
  }

  async addEvidence(tenantId: string, projectId: string, dto: AddEvidenceDto) {
    await this.getProject(tenantId, projectId);
    return this.prisma.senseiEvidence.create({
      data: { project_id: projectId, ...dto },
    });
  }

  async deleteEvidence(tenantId: string, projectId: string, evidenceId: string) {
    await this.getProject(tenantId, projectId);
    return this.prisma.senseiEvidence.delete({ where: { id: evidenceId } });
  }

  async sendMessage(tenantId: string, projectId: string, dto: SendMessageDto) {
    const project = await this.getProject(tenantId, projectId);

    // Guarda mensaje del usuario
    await this.prisma.senseiMessage.create({
      data: {
        project_id: projectId,
        role: 'user',
        content: dto.content,
        phase: project.phase,
      },
    });

    // Construye historial para Claude
    const history = project.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    history.push({ role: 'user', content: dto.content });

    // Contexto adicional: evidencia disponible
    const evidenceSummary = project.evidence.length > 0
      ? `\n\nEvidencia disponible:\n${project.evidence.map(e => `- ${e.type}: ${e.label ?? e.filename ?? e.url}`).join('\n')}`
      : '';

    const systemPrompt = buildSystemPrompt(project, project.phase) + evidenceSummary;

    // Llama a Claude
    const response = await this.ai.chat({
      tenantId,
      agentRole: 'ceo',
      systemPrompt: systemPrompt,
      messages: history,
      maxTokens: 1500,
    });

    const assistantContent = response.response ?? '';

    // Guarda respuesta de Sensei
    await this.prisma.senseiMessage.create({
      data: {
        project_id: projectId,
        role: 'assistant',
        content: assistantContent,
        phase: project.phase,
      },
    });

    // Auto-avanza fase si aplica
    await this.maybeAdvancePhase(project, project.messages.length + 2);

    return { content: assistantContent, phase: project.phase };
  }

  private async maybeAdvancePhase(project: any, totalMessages: number) {
    const transitions: Record<string, { threshold: number; next: string }> = {
      intake:          { threshold: 6,  next: 'base_questions' },
      base_questions:  { threshold: 22, next: 'analysis' },   // ~8 preguntas * 2 + intro
      deep_questions:  { threshold: 10, next: 'draft' },
    };
    const t = transitions[project.phase];
    if (t && totalMessages >= t.threshold) {
      await this.prisma.senseiSkillProject.update({
        where: { id: project.id },
        data: { phase: t.next },
      });
    }
  }

  async advancePhase(tenantId: string, projectId: string, toPhase: string) {
    await this.getProject(tenantId, projectId);
    return this.prisma.senseiSkillProject.update({
      where: { id: projectId },
      data: { phase: toPhase },
    });
  }

  async runIteration(tenantId: string, projectId: string, dto: RunIterationDto) {
    const project = await this.getProject(tenantId, projectId);

    const nextNumber = project.iterations.length + 1;

    // Si tiene deliverable_skill, usa el template engine
    let outputHtml: string | null = null;
    if (project.deliverable_skill_id) {
      const skill = await this.prisma.deliverableSkill.findUnique({
        where: { id: project.deliverable_skill_id },
      });
      if (skill?.html_template) {
        outputHtml = this.fillTemplate(
          skill.html_template,
          (skill.fixed_fields as Record<string, string>) ?? {},
          dto.input_data,
        );
      }
    }

    // Si no tiene template, pide a Claude que genere el documento según el skill
    if (!outputHtml && project.system_prompt_piece) {
      const resp = await this.ai.chat({
        tenantId,
        agentRole: 'ceo',
        systemPrompt: `You are executing the following agent skill. Generate the exact output document in HTML format based on the inputs provided.\n\nSKILL:\n${project.system_prompt_piece}`,
        messages: [{ role: 'user', content: `Inputs:\n${JSON.stringify(dto.input_data, null, 2)}\n\nGenerate the complete HTML document.` }],
        maxTokens: 4000,
      });
      outputHtml = resp.response ?? null;
    }

    const iteration = await this.prisma.senseiIteration.create({
      data: {
        project_id: projectId,
        number: nextNumber,
        input_data: dto.input_data,
        output_html: outputHtml,
      },
    });

    await this.prisma.senseiSkillProject.update({
      where: { id: projectId },
      data: { iteration_count: nextNumber, phase: 'iterations' },
    });

    return iteration;
  }

  async submitFeedback(tenantId: string, projectId: string, iterationId: string, dto: IterationFeedbackDto) {
    await this.getProject(tenantId, projectId);
    return this.prisma.senseiIteration.update({
      where: { id: iterationId },
      data: { feedback: dto.feedback, score: dto.score, approved: dto.approved },
    });
  }

  async certify(tenantId: string, projectId: string, dto: CertifySkillDto) {
    const project = await this.getProject(tenantId, projectId);
    return this.prisma.senseiSkillProject.update({
      where: { id: projectId },
      data: {
        phase: 'certified',
        deliverable_skill_id: dto.deliverable_skill_id ?? project.deliverable_skill_id,
      },
    });
  }

  private fillTemplate(template: string, fixed: Record<string, string>, intake: Record<string, string>): string {
    let result = template;
    for (const [k, v] of Object.entries(fixed)) {
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    for (const [k, v] of Object.entries(intake)) {
      result = result.replace(new RegExp(`\\{\\{${k.toUpperCase()}\\}\\}`, 'g'), v);
    }
    return result;
  }
}
