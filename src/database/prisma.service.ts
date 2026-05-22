import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly prisma: InstanceType<typeof PrismaClient>;

  constructor() {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    this.prisma = new PrismaClient({ adapter });
  }

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  // ── Core ─────────────────────────────────────────────────────────────────
  get tenant() { return this.prisma.tenant; }
  get department() { return this.prisma.department; }
  get teamSlot() { return this.prisma.teamSlot; }
  get schedule() { return this.prisma.schedule; }
  get timeLog() { return this.prisma.timeLog; }
  get message() { return this.prisma.message; }
  get room() { return this.prisma.room; }
  get file() { return this.prisma.file; }
  get notification() { return this.prisma.notification; }
  get integration() { return this.prisma.integration; }
  get auditLog() { return this.prisma.auditLog; }
  get onboardingProgress() { return this.prisma.onboardingProgress; }
  get industryTemplate() { return this.prisma.industryTemplate; }

  // ── Segundo Cerebro ───────────────────────────────────────────────────────
  get agentMemory() { return this.prisma.agentMemory; }
  get agentConversation() { return this.prisma.agentConversation; }
  get agentMessage() { return this.prisma.agentMessage; }

  // ── Productividad personal ────────────────────────────────────────────────
  get task() { return this.prisma.task; }
  get goal() { return this.prisma.goal; } // quick goals del CEO Agent (diferente de KSFs AUP)
  get calendarEvent() { return this.prisma.calendarEvent; }
  get dashboardConfig() { return this.prisma.dashboardConfig; }
  get dashboardWidget() { return this.prisma.dashboardWidget; }

  // ── CRM ───────────────────────────────────────────────────────────────────
  get contact() { return this.prisma.contact; }
  get contactActivity() { return this.prisma.contactActivity; }
  get pipeline() { return this.prisma.pipeline; }
  get pipelineStage() { return this.prisma.pipelineStage; }
  get deal() { return this.prisma.deal; }

  // ── Base de conocimiento ──────────────────────────────────────────────────
  get knowledgeBase() { return this.prisma.knowledgeBase; }
  get knowledgeChunk() { return this.prisma.knowledgeChunk; }

  // ── Capacitación ──────────────────────────────────────────────────────────
  get course() { return this.prisma.course; }
  get courseModule() { return this.prisma.courseModule; }
  get courseProgress() { return this.prisma.courseProgress; }
  get certification() { return this.prisma.certification; }

  // ── War Room ──────────────────────────────────────────────────────────────
  get meeting() { return this.prisma.meeting; }

  // ── Reportes ──────────────────────────────────────────────────────────────
  get report() { return this.prisma.report; }

  // ── Campus ────────────────────────────────────────────────────────────────
  get mapProp() { return this.prisma.mapProp; }

  // ── Spaces & Cameras ──────────────────────────────────────────────────────
  get space() { return this.prisma.space; }
  get camera() { return this.prisma.camera; }

  // ── Culture Module ────────────────────────────────────────────────────────
  get cultureConfig() { return this.prisma.cultureConfig; }
  get culturePrinciple() { return this.prisma.culturePrinciple; }
  get cultureRitual() { return this.prisma.cultureRitual; }

  // ── Culture Engine ────────────────────────────────────────────────────────
  get founderProfile() { return this.prisma.founderProfile; }
  get communicationProfile() { return this.prisma.communicationProfile; }
  get cultureBlueprint() { return this.prisma.cultureBlueprint; }
  get operatingMap() { return this.prisma.operatingMap; }

  // ── AUP Goals Module ──────────────────────────────────────────────────────
  get strategicPurpose() { return this.prisma.strategicPurpose; }
  get ksfRelationship() { return this.prisma.ksfRelationship; }
  get successArea() { return this.prisma.successArea; }
  get keySuccessFactor() { return this.prisma.keySuccessFactor; }
  get ksfMilestone() { return this.prisma.ksfMilestone; }
  get escalationConfig() { return this.prisma.escalationConfig; }
  get goalMeasurement() { return this.prisma.goalMeasurement; }
  get focusReport() { return this.prisma.focusReport; }
  get feedbackReport() { return this.prisma.feedbackReport; }
  get managementReport() { return this.prisma.managementReport; }
  get recognitionEvent() { return this.prisma.recognitionEvent; }
  get goalSetupStatus() { return this.prisma.goalSetupStatus; }

  // Transacción estándar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction(...args: any[]): any {
    return (this.prisma.$transaction as any)(...args);
  }

  // Transacción con tenant_id inyectado en la sesión de Postgres.
  // Úsalo en operaciones sensibles para activar Supabase RLS:
  //   await this.prisma.withTenant(tenantId, tx => tx.contact.findMany(...))
  // Requiere que las políticas de supabase-rls.sql estén aplicadas en la BD.
  async withTenant<T>(tenantId: string, fn: (tx: Omit<typeof this, 'withTenant' | '$transaction'>) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }) as Promise<T>;
  }
}
