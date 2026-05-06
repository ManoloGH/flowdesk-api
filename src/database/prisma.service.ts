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
  get goal() { return this.prisma.goal; }
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

  // ── Reuniones grabadas ────────────────────────────────────────────────────
  get meeting() { return this.prisma.meeting; }

  // ── Reportes ──────────────────────────────────────────────────────────────
  get report() { return this.prisma.report; }

  // ── Campus ────────────────────────────────────────────────────────────────
  get mapProp() { return this.prisma.mapProp; }

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
