import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateDeliverableSkillDto,
  UpdateDeliverableSkillDto,
  GenerateDocumentDto,
} from './dto/deliverable-skills.dto';

@Injectable()
export class DeliverableSkillsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Skills CRUD ─────────────────────────────────────────────────────

  async listSkills(tenantId: string) {
    return this.prisma.deliverableSkill.findMany({
      where: { tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        doc_type: true,
        output_format: true,
        status: true,
        created_at: true,
        _count: { select: { generations: true } },
      },
    });
  }

  async getSkill(tenantId: string, skillId: string) {
    const skill = await this.prisma.deliverableSkill.findFirst({
      where: { id: skillId, tenant_id: tenantId },
      include: { _count: { select: { generations: true } } },
    });
    if (!skill) throw new NotFoundException('Skill no encontrada');
    return skill;
  }

  async createSkill(tenantId: string, dto: CreateDeliverableSkillDto) {
    return this.prisma.deliverableSkill.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        description: dto.description,
        doc_type: dto.doc_type,
        output_format: dto.output_format ?? 'HTML',
        intake_schema: dto.intake_schema as any,
        business_rules: dto.business_rules as any ?? [],
        html_template: dto.html_template,
        fixed_fields: dto.fixed_fields as any ?? {},
        spec_md: dto.spec_md,
        status: dto.status ?? 'draft',
      },
    });
  }

  async updateSkill(tenantId: string, skillId: string, dto: UpdateDeliverableSkillDto) {
    await this.getSkill(tenantId, skillId);
    return this.prisma.deliverableSkill.update({
      where: { id: skillId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.doc_type !== undefined && { doc_type: dto.doc_type }),
        ...(dto.output_format !== undefined && { output_format: dto.output_format }),
        ...(dto.intake_schema !== undefined && { intake_schema: dto.intake_schema as any }),
        ...(dto.business_rules !== undefined && { business_rules: dto.business_rules as any }),
        ...(dto.html_template !== undefined && { html_template: dto.html_template }),
        ...(dto.fixed_fields !== undefined && { fixed_fields: dto.fixed_fields as any }),
        ...(dto.spec_md !== undefined && { spec_md: dto.spec_md }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async deleteSkill(tenantId: string, skillId: string) {
    await this.getSkill(tenantId, skillId);
    await this.prisma.deliverableSkill.delete({ where: { id: skillId } });
    return { ok: true };
  }

  // ── Generación ───────────────────────────────────────────────────────

  async generate(tenantId: string, skillId: string, userId: string, dto: GenerateDocumentDto) {
    const skill = await this.getSkill(tenantId, skillId);

    if (skill.output_format !== 'HTML') {
      throw new BadRequestException('Solo se soporta generación HTML en esta versión');
    }

    if (!skill.html_template) {
      throw new BadRequestException('La skill no tiene plantilla HTML configurada');
    }

    const outputHtml = this.fillTemplate(
      skill.html_template,
      (skill.fixed_fields as Record<string, string>) ?? {},
      dto.intake_data,
    );

    const generation = await this.prisma.deliverableGeneration.create({
      data: {
        skill_id: skillId,
        tenant_id: tenantId,
        intake_data: dto.intake_data as any,
        output_html: outputHtml,
        client_ref: dto.client_ref,
        generated_by: userId,
      },
    });

    return {
      id: generation.id,
      token: generation.public_token,
      output_html: outputHtml,
      residual_placeholders: this.findResidual(outputHtml),
    };
  }

  // ── Historial ────────────────────────────────────────────────────────

  async listGenerations(tenantId: string, skillId: string) {
    await this.getSkill(tenantId, skillId);
    return this.prisma.deliverableGeneration.findMany({
      where: { skill_id: skillId, tenant_id: tenantId },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: {
        id: true,
        public_token: true,
        client_ref: true,
        generated_by: true,
        created_at: true,
        intake_data: true,
      },
    });
  }

  async getGenerationByToken(token: string) {
    const gen = await this.prisma.deliverableGeneration.findUnique({
      where: { public_token: token },
      include: {
        skill: {
          select: { name: true, doc_type: true, output_format: true },
        },
      },
    });
    if (!gen) throw new NotFoundException('Documento no encontrado');
    return gen;
  }

  // ── Motor de relleno ─────────────────────────────────────────────────

  private fillTemplate(
    template: string,
    fixedFields: Record<string, string>,
    intakeData: Record<string, string>,
  ): string {
    let html = template;
    // Fixed fields primero (no los pregunta el usuario)
    for (const [key, value] of Object.entries(fixedFields)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
    }
    // Intake data
    for (const [key, value] of Object.entries(intakeData)) {
      html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
    }
    return html;
  }

  private findResidual(html: string): string[] {
    const matches = html.match(/\{\{[^}]+\}\}/g);
    return matches ? [...new Set(matches)] : [];
  }
}
