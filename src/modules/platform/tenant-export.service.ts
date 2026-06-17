import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';

export interface TenantExportResult {
  sql: string;
  vault: Record<string, string>;
  stats: { table: string; count: number }[];
}

@Injectable()
export class TenantExportService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async exportTenant(tenantId: string): Promise<TenantExportResult> {
    const lines: string[] = [];
    const vault: Record<string, string> = {};
    const stats: { table: string; count: number }[] = [];

    lines.push(`-- ════════════════════════════════════════════════════`);
    lines.push(`-- FlowDesk — Exportación completa de tenant`);
    lines.push(`-- ID:      ${tenantId}`);
    lines.push(`-- Fecha:   ${new Date().toISOString()}`);
    lines.push(`-- AVISO:   Importar en instancia con Prisma migrate aplicado`);
    lines.push(`-- AVISO:   Requiere la misma ENCRYPTION_KEY para descifrar Vault`);
    lines.push(`-- ════════════════════════════════════════════════════`);
    lines.push('');
    lines.push('BEGIN;');
    lines.push('');
    // Disable FK checks to allow any insert order
    lines.push('SET session_replication_role = replica;');
    lines.push('');

    // ── Fetch all data in parallel ────────────────────────────────────────────
    const [
      tenant,
      departments,
      schedules,
      teamSlots,
      rooms,
      spaces,
      cameras,
      onboardingProgress,
      agentMemories,
      conversations,
      tasks,
      goals,
      calendarEvents,
      dashboardConfigs,
      dashboardWidgets,
      contacts,
      contactActivities,
      pipelines,
      pipelineStages,
      deals,
      knowledgeBases,
      knowledgeChunks,
      courses,
      courseModules,
      courseProgress,
      certifications,
      mapProps,
      reports,
      messages,
      files,
      notifications,
      auditLogs,
      integrations,
      strategicPurpose,
      ksfRelationships,
      successAreas,
      ksfs,
      cultureConfig,
      culturePrinciples,
      cultureRituals,
      founderProfile,
      communicationProfile,
      cultureBlueprint,
      operatingMap,
      billingConfig,
      secretaryConfig,
      pendingApprovals,
      delegationHistory,
      workReports,
      vaultEntries,
      meetings,
      phoneCalls,
      learningProposals,
      webProyectos,
      escalationConfigs,
      focusReports,
      feedbackReports,
      managementReports,
      recognitionEvents,
      goalSetupStatuses,
    ] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
      this.prisma.department.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.schedule.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.teamSlot.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.room.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.space.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.camera.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.onboardingProgress.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.agentMemory.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.agentConversation.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.task.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.goal.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.calendarEvent.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.dashboardConfig.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.dashboardWidget.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.contact.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.contactActivity.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.pipeline.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.pipelineStage.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.deal.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.knowledgeBase.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.knowledgeChunk.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.course.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.courseModule.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.courseProgress.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.certification.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.mapProp.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.report.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.message.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.file.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.notification.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.auditLog.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.integration.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.strategicPurpose.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.ksfRelationship.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.successArea.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.keySuccessFactor.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.cultureConfig.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.culturePrinciple.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.cultureRitual.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.founderProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.communicationProfile.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.cultureBlueprint.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.operatingMap.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.billingConfig.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.secretaryConfig.findUnique({ where: { tenant_id: tenantId } }),
      this.prisma.pendingApproval.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.delegationHistory.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.workReport.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.vaultEntry.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.meeting.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.phoneCall.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.agentLearningProposal.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.webProyecto.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.escalationConfig.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.focusReport.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.feedbackReport.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.managementReport.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.recognitionEvent.findMany({ where: { tenant_id: tenantId } }),
      this.prisma.goalSetupStatus.findMany({ where: { tenant_id: tenantId } }),
    ]);

    // Tables without tenant_id — query via parent IDs
    const slotIds = teamSlots.map(s => s.id);
    const convIds = conversations.map(c => c.id);
    const ksfIds = ksfs.map(k => k.id);
    const entryIds = vaultEntries.map(e => e.id);

    const [timeLogs, agentMessages, ksfMilestones, goalMeasurements, vaultAccessLogs] = await Promise.all([
      slotIds.length ? this.prisma.timeLog.findMany({ where: { slot_id: { in: slotIds } } }) : Promise.resolve([]),
      convIds.length ? this.prisma.agentMessage.findMany({ where: { conversation_id: { in: convIds } } }) : Promise.resolve([]),
      ksfIds.length ? this.prisma.ksfMilestone.findMany({ where: { ksf_id: { in: ksfIds } } }) : Promise.resolve([]),
      ksfIds.length ? this.prisma.goalMeasurement.findMany({ where: { ksf_id: { in: ksfIds } } }) : Promise.resolve([]),
      entryIds.length ? this.prisma.vaultAccessLog.findMany({ where: { entry_id: { in: entryIds } } }) : Promise.resolve([]),
    ]);

    // Brain documents via raw SQL (Unsupported vector field)
    const brainDocs = await this.prisma.$queryRaw<Array<{
      id: string; tenant_id: string; source_type: string; source_id: string | null;
      title: string; content: string; metadata: string; created_at: Date; updated_at: Date;
      embedding: string | null;
    }>>`
      SELECT id, tenant_id, source_type, source_id, title, content,
             metadata::text as metadata, created_at, updated_at,
             embedding::text as embedding
      FROM "EmpresaBrainDocument"
      WHERE tenant_id = ${tenantId}
    `;

    // Decrypt vault entries to extract real .env values
    for (const entry of vaultEntries) {
      try {
        vault[entry.key_name] = this.encryption.safeDecrypt(entry.encrypted_value);
      } catch {
        vault[entry.key_name] = '[CIFRADO - misma ENCRYPTION_KEY requerida]';
      }
    }

    // ── Generate SQL ─────────────────────────────────────────────────────────

    // Tenant (single record)
    if (tenant) this.appendRows(lines, stats, 'Tenant', [tenant]);

    // Departments (two-pass: parent_id is self-referential)
    this.appendRows(lines, stats, 'Department', departments.map(d => ({ ...d, parent_id: null })));
    for (const d of departments) {
      if (d.parent_id) {
        lines.push(`UPDATE "Department" SET parent_id = ${this.val(d.parent_id)} WHERE id = ${this.val(d.id)};`);
      }
    }
    lines.push('');

    // Schedules
    this.appendRows(lines, stats, 'Schedule', schedules);

    // TeamSlots (two-pass: reports_to_id + owner_slot_id are self-referential)
    this.appendRows(lines, stats, 'TeamSlot', teamSlots.map(s => ({ ...s, reports_to_id: null, owner_slot_id: null })));
    for (const s of teamSlots) {
      if (s.reports_to_id || s.owner_slot_id) {
        const sets = [
          s.reports_to_id ? `reports_to_id = ${this.val(s.reports_to_id)}` : null,
          s.owner_slot_id ? `owner_slot_id = ${this.val(s.owner_slot_id)}` : null,
        ].filter(Boolean).join(', ');
        lines.push(`UPDATE "TeamSlot" SET ${sets} WHERE id = ${this.val(s.id)};`);
      }
    }
    lines.push('');

    // Rooms / Spaces / Cameras
    this.appendRows(lines, stats, 'Room', rooms);
    this.appendRows(lines, stats, 'Space', spaces);
    this.appendRows(lines, stats, 'Camera', cameras);

    // Onboarding
    if (onboardingProgress) this.appendRows(lines, stats, 'OnboardingProgress', [onboardingProgress]);

    // Agent data
    this.appendRows(lines, stats, 'AgentMemory', agentMemories);
    this.appendRows(lines, stats, 'AgentConversation', conversations);
    this.appendRows(lines, stats, 'AgentMessage', agentMessages);

    // Productivity
    this.appendRows(lines, stats, 'Task', tasks);
    this.appendRows(lines, stats, 'Goal', goals);
    this.appendRows(lines, stats, 'CalendarEvent', calendarEvents);
    this.appendRows(lines, stats, 'TimeLog', timeLogs);

    // Dashboard
    this.appendRows(lines, stats, 'DashboardConfig', dashboardConfigs);
    this.appendRows(lines, stats, 'DashboardWidget', dashboardWidgets);

    // CRM
    this.appendRows(lines, stats, 'Contact', contacts);
    this.appendRows(lines, stats, 'ContactActivity', contactActivities);
    this.appendRows(lines, stats, 'Pipeline', pipelines);
    this.appendRows(lines, stats, 'PipelineStage', pipelineStages);
    this.appendRows(lines, stats, 'Deal', deals);

    // Knowledge
    this.appendRows(lines, stats, 'KnowledgeBase', knowledgeBases);
    this.appendRows(lines, stats, 'KnowledgeChunk', knowledgeChunks);

    // Training
    this.appendRows(lines, stats, 'Course', courses);
    this.appendRows(lines, stats, 'CourseModule', courseModules);
    this.appendRows(lines, stats, 'CourseProgress', courseProgress);
    this.appendRows(lines, stats, 'Certification', certifications);

    // Files / Messages / Notifications / Audit / Integrations
    this.appendRows(lines, stats, 'File', files);
    this.appendRows(lines, stats, 'Message', messages);
    this.appendRows(lines, stats, 'Notification', notifications);
    this.appendRows(lines, stats, 'AuditLog', auditLogs);
    this.appendRows(lines, stats, 'Integration', integrations);

    // Campus
    this.appendRows(lines, stats, 'MapProp', mapProps);

    // Reports
    this.appendRows(lines, stats, 'Report', reports);

    // AUP
    if (strategicPurpose) this.appendRows(lines, stats, 'StrategicPurpose', [strategicPurpose]);
    this.appendRows(lines, stats, 'KsfRelationship', ksfRelationships);
    this.appendRows(lines, stats, 'SuccessArea', successAreas);

    // KeySuccessFactor (two-pass: parent_ksf_id is self-referential)
    this.appendRows(lines, stats, 'KeySuccessFactor', ksfs.map(k => ({ ...k, parent_ksf_id: null })));
    for (const k of ksfs) {
      if (k.parent_ksf_id) {
        lines.push(`UPDATE "KeySuccessFactor" SET parent_ksf_id = ${this.val(k.parent_ksf_id)} WHERE id = ${this.val(k.id)};`);
      }
    }
    lines.push('');

    this.appendRows(lines, stats, 'KsfMilestone', ksfMilestones);
    this.appendRows(lines, stats, 'EscalationConfig', escalationConfigs);
    this.appendRows(lines, stats, 'GoalMeasurement', goalMeasurements);
    this.appendRows(lines, stats, 'FocusReport', focusReports);
    this.appendRows(lines, stats, 'FeedbackReport', feedbackReports);
    this.appendRows(lines, stats, 'ManagementReport', managementReports);
    this.appendRows(lines, stats, 'RecognitionEvent', recognitionEvents);
    this.appendRows(lines, stats, 'GoalSetupStatus', goalSetupStatuses);

    // Culture
    if (cultureConfig) this.appendRows(lines, stats, 'CultureConfig', [cultureConfig]);
    this.appendRows(lines, stats, 'CulturePrinciple', culturePrinciples);
    this.appendRows(lines, stats, 'CultureRitual', cultureRituals);
    if (founderProfile) this.appendRows(lines, stats, 'FounderProfile', [founderProfile]);
    if (communicationProfile) this.appendRows(lines, stats, 'CommunicationProfile', [communicationProfile]);
    if (cultureBlueprint) this.appendRows(lines, stats, 'CultureBlueprint', [cultureBlueprint]);
    if (operatingMap) this.appendRows(lines, stats, 'OperatingMap', [operatingMap]);

    // Config
    if (billingConfig) this.appendRows(lines, stats, 'BillingConfig', [billingConfig]);
    if (secretaryConfig) this.appendRows(lines, stats, 'SecretaryConfig', [secretaryConfig]);
    this.appendRows(lines, stats, 'PendingApproval', pendingApprovals);
    this.appendRows(lines, stats, 'DelegationHistory', delegationHistory);
    this.appendRows(lines, stats, 'WorkReport', workReports);

    // Vault (encrypted, same ENCRYPTION_KEY required on destination)
    this.appendRows(lines, stats, 'VaultEntry', vaultEntries);
    this.appendRows(lines, stats, 'VaultAccessLog', vaultAccessLogs);

    // Meetings & Calls (PhoneCall uses @@map("calls"))
    this.appendRows(lines, stats, 'Meeting', meetings);
    this.appendRows(lines, stats, 'calls', phoneCalls as any[]);

    // Brain documents (requires special vector casting)
    if (brainDocs.length > 0) {
      lines.push(`-- ── EmpresaBrainDocument (${brainDocs.length} documentos)`);
      for (const doc of brainDocs) {
        const embeddingVal = doc.embedding ? `'${doc.embedding}'::vector` : 'NULL';
        const metaVal = doc.metadata
          ? `'${doc.metadata.replace(/'/g, "''")}'::jsonb`
          : "'{}'::jsonb";
        lines.push(
          `INSERT INTO "EmpresaBrainDocument" ` +
          `(id, tenant_id, source_type, source_id, title, content, embedding, metadata, created_at, updated_at) ` +
          `VALUES (${this.val(doc.id)}, ${this.val(doc.tenant_id)}, ${this.val(doc.source_type)}, ` +
          `${this.val(doc.source_id)}, ${this.val(doc.title)}, ${this.val(doc.content)}, ` +
          `${embeddingVal}, ${metaVal}, ${this.val(doc.created_at)}, ${this.val(doc.updated_at)}) ` +
          `ON CONFLICT (id) DO NOTHING;`,
        );
      }
      stats.push({ table: 'EmpresaBrainDocument', count: brainDocs.length });
      lines.push('');
    }

    // Agent learning & web projects
    this.appendRows(lines, stats, 'AgentLearningProposal', learningProposals);
    this.appendRows(lines, stats, 'WebProyecto', webProyectos);

    // Restore FK checks
    lines.push('SET session_replication_role = DEFAULT;');
    lines.push('');
    lines.push('COMMIT;');

    return { sql: lines.join('\n'), vault, stats };
  }

  private appendRows(
    lines: string[],
    stats: { table: string; count: number }[],
    table: string,
    rows: any[],
  ): void {
    if (!rows || rows.length === 0) return;
    lines.push(`-- ── ${table} (${rows.length})`);
    for (const row of rows) {
      lines.push(this.insertRow(table, row));
    }
    lines.push('');
    stats.push({ table, count: rows.length });
  }

  private insertRow(table: string, record: Record<string, unknown>): string {
    const entries = Object.entries(record).filter(([, v]) => v !== undefined);
    const cols = entries.map(([k]) => `"${k}"`).join(', ');
    const vals = entries.map(([, v]) => this.val(v)).join(', ');
    return `INSERT INTO "${table}" (${cols}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING;`;
  }

  private val(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
    if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    if (Array.isArray(v)) {
      // Prisma String[] fields → PostgreSQL text[]
      if (v.every((x) => typeof x === 'string')) {
        const items = (v as string[]).map((x) => `'${x.replace(/'/g, "''")}'`).join(', ');
        return `ARRAY[${items}]::text[]`;
      }
      return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    }
    if (typeof v === 'object') {
      return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
    }
    return 'NULL';
  }
}
