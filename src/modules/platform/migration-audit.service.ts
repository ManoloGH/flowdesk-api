import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EncryptionService } from '../../common/encryption/encryption.service';

export type CheckStatus = 'pass' | 'fail' | 'warning' | 'info';

export interface AuditCheck {
  id: string;
  category: string;
  name: string;
  status: CheckStatus;
  detail: string;
  count?: number;
  expected?: number;
  fix?: string;
}

export interface TableStat {
  table: string;
  count: number;
}

export interface MigrationAuditReport {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  audited_at: string;
  overall: CheckStatus;
  score: number;
  checks: AuditCheck[];
  table_stats: TableStat[];
  errors: string[];
  warnings: string[];
}

@Injectable()
export class MigrationAuditService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async runPreMigrationAudit(tenantId: string): Promise<MigrationAuditReport> {
    const checks: AuditCheck[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── 1. TENANT ────────────────────────────────────────────────────────────
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        team_slots: true,
        secretary_config: true,
        onboarding_progress: true,
        vault_entries: true,
        brain_documents: { select: { id: true } },
      },
    });

    if (!tenant) {
      return {
        tenant_id: tenantId, tenant_name: '?', tenant_slug: '?',
        audited_at: new Date().toISOString(), overall: 'fail', score: 0,
        checks: [{ id: 'tenant_found', category: 'Base', name: 'Tenant existe', status: 'fail', detail: 'Tenant no encontrado en la base de datos', fix: 'Verificar que el ID sea correcto' }],
        table_stats: [], errors: ['Tenant no encontrado'], warnings: [],
      };
    }

    // ── 2. ESTRUCTURA BÁSICA ─────────────────────────────────────────────────
    checks.push({
      id: 'tenant_found',
      category: 'Base',
      name: 'Tenant existe y es válido',
      status: 'pass',
      detail: `${tenant.name} (slug: ${tenant.slug})`,
    });

    const ownerSlot = tenant.team_slots.find(s => s.role === 'owner' && s.type === 'HUMAN');
    checks.push({
      id: 'owner_slot',
      category: 'Base',
      name: 'Slot owner (administrador) presente',
      status: ownerSlot ? 'pass' : 'fail',
      detail: ownerSlot ? `${ownerSlot.name} <${ownerSlot.email ?? '—'}>` : 'No existe ningún slot con role=owner y type=HUMAN',
      fix: !ownerSlot ? 'El tenant debe tener al menos un humano con role=owner' : undefined,
    });
    if (!ownerSlot) errors.push('Falta slot owner');

    const humanSlots = tenant.team_slots.filter(s => s.type === 'HUMAN');
    const agentSlots = tenant.team_slots.filter(s => s.type === 'AI_AGENT');
    checks.push({
      id: 'team_slots',
      category: 'Base',
      name: 'Slots del equipo exportados',
      status: tenant.team_slots.length > 0 ? 'pass' : 'warning',
      detail: `${humanSlots.length} humanos + ${agentSlots.length} agentes IA`,
      count: tenant.team_slots.length,
    });

    // ── 3. AGENTES IA ────────────────────────────────────────────────────────
    const agentsWithConfig = agentSlots.filter(s => s.agent_config !== null);
    const agentsWithInvalidConfig: string[] = [];
    for (const agent of agentSlots) {
      if (agent.agent_config !== null) {
        try {
          if (typeof agent.agent_config !== 'object') JSON.parse(agent.agent_config as string);
        } catch {
          agentsWithInvalidConfig.push(agent.name);
        }
      }
    }
    checks.push({
      id: 'agent_configs',
      category: 'Agentes IA',
      name: 'Configuraciones de agentes válidas',
      status: agentsWithInvalidConfig.length === 0 ? 'pass' : 'fail',
      detail: agentsWithInvalidConfig.length === 0
        ? `${agentsWithConfig.length}/${agentSlots.length} agentes tienen configuración`
        : `Configs inválidas: ${agentsWithInvalidConfig.join(', ')}`,
      count: agentsWithConfig.length,
      expected: agentSlots.length,
      fix: agentsWithInvalidConfig.length > 0 ? 'Editar el agent_config de los agentes listados y asegurar JSON válido' : undefined,
    });
    if (agentsWithInvalidConfig.length > 0) errors.push(`agent_config inválido en: ${agentsWithInvalidConfig.join(', ')}`);

    // ── 4. JERARQUÍA DE SLOTS (self-references) ───────────────────────────────
    const slotIds = new Set(tenant.team_slots.map(s => s.id));
    const orphanReportsTo = tenant.team_slots.filter(
      s => s.reports_to_id && !slotIds.has(s.reports_to_id),
    );
    const orphanOwnerSlot = tenant.team_slots.filter(
      s => s.owner_slot_id && !slotIds.has(s.owner_slot_id),
    );
    const hierarchyOk = orphanReportsTo.length === 0 && orphanOwnerSlot.length === 0;
    checks.push({
      id: 'slot_hierarchy',
      category: 'Agentes IA',
      name: 'Jerarquía de slots sin referencias rotas',
      status: hierarchyOk ? 'pass' : 'warning',
      detail: hierarchyOk
        ? 'Todas las referencias reports_to_id y owner_slot_id son válidas'
        : `${orphanReportsTo.length} reports_to_id rotos + ${orphanOwnerSlot.length} owner_slot_id rotos`,
      fix: !hierarchyOk ? 'Las referencias apuntan a slots que no existen en este tenant. Se corregirán a NULL durante la importación.' : undefined,
    });
    if (!hierarchyOk) warnings.push('Referencias de jerarquía rotas — se importarán como NULL');

    // ── 5. VAULT ─────────────────────────────────────────────────────────────
    const vaultEntries = tenant.vault_entries;
    const failedDecrypt: string[] = [];
    let successDecrypt = 0;
    for (const entry of vaultEntries) {
      try {
        this.encryption.safeDecrypt(entry.encrypted_value);
        successDecrypt++;
      } catch {
        failedDecrypt.push(entry.key_name);
      }
    }
    const vaultStatus: CheckStatus = failedDecrypt.length === 0 ? 'pass' : vaultEntries.length === failedDecrypt.length ? 'fail' : 'warning';
    checks.push({
      id: 'vault_decrypt',
      category: 'Seguridad',
      name: 'Vault — credenciales descifrables',
      status: vaultStatus,
      detail: failedDecrypt.length === 0
        ? `${vaultEntries.length} credenciales correctamente cifradas`
        : `${successDecrypt}/${vaultEntries.length} OK. Fallan: ${failedDecrypt.join(', ')}`,
      count: successDecrypt,
      expected: vaultEntries.length,
      fix: failedDecrypt.length > 0 ? 'Asegúrate de que ENCRYPTION_KEY en el .env del destino sea idéntica a la incluida en el bundle' : undefined,
    });
    if (failedDecrypt.length > 0) errors.push(`Vault no descifrable: ${failedDecrypt.join(', ')}`);

    const hasEvolutionKey = vaultEntries.some(e => e.key_name.toLowerCase().includes('evolution'));
    const hasAiKey = vaultEntries.some(e =>
      ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENAI_KEY'].includes(e.key_name),
    );
    checks.push({
      id: 'vault_keys_present',
      category: 'Seguridad',
      name: 'Claves de IA y WhatsApp en Vault',
      status: hasEvolutionKey && hasAiKey ? 'pass' : 'warning',
      detail: [
        hasAiKey ? '✓ Clave IA (Anthropic/OpenAI)' : '✗ Falta clave IA',
        hasEvolutionKey ? '✓ Evolution API Key' : '✗ Falta Evolution API Key',
      ].join(' · '),
      fix: !hasAiKey || !hasEvolutionKey ? 'Añade las claves faltantes en el .env antes de instalar' : undefined,
    });
    if (!hasAiKey) warnings.push('Falta clave de IA en Vault');
    if (!hasEvolutionKey) warnings.push('Falta EVOLUTION_API_KEY en Vault');

    // ── 6. BRAIN / VECTORES ──────────────────────────────────────────────────
    const brainTotal = tenant.brain_documents.length;
    const brainWithVector = await this.prisma.$queryRaw<[{ cnt: BigInt }]>`
      SELECT COUNT(*) as cnt FROM "EmpresaBrainDocument"
      WHERE tenant_id = ${tenantId} AND embedding IS NOT NULL
    `;
    const vectorCount = Number(brainWithVector[0]?.cnt ?? 0);
    const brainStatus: CheckStatus = brainTotal === 0 ? 'info' :
      vectorCount === brainTotal ? 'pass' :
      vectorCount === 0 ? 'fail' : 'warning';
    checks.push({
      id: 'brain_vectors',
      category: 'Brain / IA',
      name: 'Documentos del Brain con embeddings',
      status: brainStatus,
      detail: brainTotal === 0
        ? 'No hay documentos en el Brain'
        : `${vectorCount}/${brainTotal} documentos tienen vector embedding`,
      count: vectorCount,
      expected: brainTotal,
      fix: vectorCount < brainTotal ? 'Algunos documentos no tienen embedding. Usa el endpoint POST /brain/reindex en el servidor destino para regenerarlos.' : undefined,
    });
    if (vectorCount < brainTotal && brainTotal > 0) warnings.push(`${brainTotal - vectorCount} documentos del Brain sin embedding`);

    // ── 7. SECRETARY / ATLAS ─────────────────────────────────────────────────
    const sec = tenant.secretary_config;
    checks.push({
      id: 'secretary_config',
      category: 'Comunicación',
      name: 'Atlas Secretario configurado',
      status: sec ? (sec.owner_phone ? 'pass' : 'warning') : 'warning',
      detail: sec
        ? `Instancia: ${sec.evolution_instance ?? '—'} · WhatsApp: ${sec.owner_phone}`
        : 'Sin configuración de secretario',
      fix: !sec ? 'Completa el onboarding en el servidor destino para configurar Atlas' : undefined,
    });
    if (!sec) warnings.push('SecretaryConfig no configurado');

    // ── 8. ONBOARDING ────────────────────────────────────────────────────────
    const ob = tenant.onboarding_progress;
    checks.push({
      id: 'onboarding',
      category: 'Base',
      name: 'Onboarding completado',
      status: ob?.completed_at ? 'pass' : 'warning',
      detail: ob
        ? ob.completed_at
          ? `Completado el ${new Date(ob.completed_at).toLocaleDateString('es-MX')}`
          : `En progreso (paso ${ob.current_step})`
        : 'Onboarding no iniciado',
    });

    // ── 9. TABLE COUNTS ──────────────────────────────────────────────────────
    const tableCounts = await this.prisma.$queryRaw<Array<{ tablename: string; count: BigInt }>>`
      SELECT tablename, (xpath('/row/c/text()', query_to_xml(format('SELECT COUNT(*) AS c FROM %I', tablename), false, true, '')))[1]::text::int AS count
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    const tableStats: TableStat[] = tableCounts.map(r => ({
      table: r.tablename,
      count: Number(r.count),
    }));

    const totalRecords = tableStats.reduce((s, t) => s + t.count, 0);
    checks.push({
      id: 'total_records',
      category: 'Datos',
      name: 'Total de registros a exportar',
      status: totalRecords > 0 ? 'pass' : 'warning',
      detail: `${totalRecords.toLocaleString()} registros en ${tableStats.filter(t => t.count > 0).length} tablas`,
      count: totalRecords,
    });

    // ── SCORE ────────────────────────────────────────────────────────────────
    const failCount = checks.filter(c => c.status === 'fail').length;
    const warnCount = checks.filter(c => c.status === 'warning').length;
    const passCount = checks.filter(c => c.status === 'pass').length;
    const total = checks.filter(c => c.status !== 'info').length;

    const score = total > 0
      ? Math.round(((passCount + warnCount * 0.5) / total) * 100)
      : 100;

    const overall: CheckStatus = failCount > 0 ? 'fail' : warnCount > 0 ? 'warning' : 'pass';

    return {
      tenant_id: tenantId,
      tenant_name: tenant.name,
      tenant_slug: tenant.slug,
      audited_at: new Date().toISOString(),
      overall,
      score,
      checks,
      table_stats: tableStats,
      errors,
      warnings,
    };
  }

  async pingRemoteInstance(self_hosted_url: string): Promise<{
    reachable: boolean;
    status_code: number | null;
    response_ms: number | null;
    error: string | null;
    checks: Array<{ name: string; status: CheckStatus; detail: string }>;
  }> {
    const checks: Array<{ name: string; status: CheckStatus; detail: string }> = [];
    const base = self_hosted_url.replace(/\/$/, '');

    const ping = async (path: string, name: string) => {
      const start = Date.now();
      try {
        const res = await fetch(`${base}${path}`, {
          signal: AbortSignal.timeout(10000),
          headers: { Accept: 'application/json' },
        });
        const ms = Date.now() - start;
        const ok = res.status >= 200 && res.status < 400;
        checks.push({
          name,
          status: ok ? 'pass' : 'warning',
          detail: `HTTP ${res.status} en ${ms}ms`,
        });
        return { ok, status: res.status, ms };
      } catch (err: any) {
        const ms = Date.now() - start;
        checks.push({
          name,
          status: 'fail',
          detail: `Error: ${err?.message ?? 'Sin respuesta'} (${ms}ms)`,
        });
        return { ok: false, status: null, ms };
      }
    };

    const health = await ping('/api/v1/health', 'API health endpoint');
    const apiRoot = await ping('/api/v1', 'API raíz responde');

    const reachable = health.ok || apiRoot.ok;

    return {
      reachable,
      status_code: health.status,
      response_ms: health.ms,
      error: reachable ? null : 'El servidor no responde o no es accesible desde FlowDesk Cloud',
      checks,
    };
  }
}
