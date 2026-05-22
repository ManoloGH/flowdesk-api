import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AirtableField {
  name: string;
  type: string;
  options?: Record<string, unknown>;
}

interface AirtableTableDef {
  name: string;
  fields: AirtableField[];
}

interface RegisterClientDto {
  tenant_id: string;
  company_name: string;
  owner_name: string;
  owner_email: string;
  external_ref?: string; // código de proyecto / propuesta si viene de Airtable
}

@Injectable()
export class AirtableService {
  private readonly logger = new Logger(AirtableService.name);
  private readonly baseUrl = 'https://api.airtable.com';

  constructor(private config: ConfigService) {}

  private get pat(): string {
    return this.config.get<string>('AIRTABLE_PAT') ?? '';
  }

  private get erpBaseId(): string {
    return this.config.get<string>('AIRTABLE_ERP_BASE_ID') ?? '';
  }

  private get isConfigured(): boolean {
    return !!(this.pat && this.erpBaseId);
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.pat}`,
      'Content-Type': 'application/json',
    };
  }

  // ── 1. Registrar nuevo cliente en el ERP de MentorIA ─────────────────────────

  async registerClientInERP(data: RegisterClientDto): Promise<{ crm_id?: string; project_id?: string }> {
    if (!this.isConfigured) {
      this.logger.warn('Airtable no configurado (AIRTABLE_PAT / AIRTABLE_ERP_BASE_ID vacíos). Saltando registro ERP.');
      return {};
    }

    try {
      const crmId = await this.createCRMContact(data);
      const projectId = await this.createProject(data, crmId);
      this.logger.log(`Cliente "${data.company_name}" registrado en ERP — CRM: ${crmId}, Proyecto: ${projectId}`);
      return { crm_id: crmId, project_id: projectId };
    } catch (err: any) {
      // No bloqueamos el onboarding si falla Airtable
      this.logger.error(`Error registrando cliente en ERP Airtable: ${err.message}`);
      return {};
    }
  }

  private async createCRMContact(data: RegisterClientDto): Promise<string> {
    const today = new Date().toISOString().split('T')[0];

    const body = {
      fields: {
        'Nombre contacto': data.owner_name,
        Email: data.owner_email,
        Empresa: data.company_name,
        'Estado cuenta': 'Cliente activo',
        'Estado pipeline': 'Ganado',
      },
    };

    // Verificar si ya existe el contacto por email
    const existing = await this.findRecordByField('CRM', 'Email', data.owner_email);
    if (existing) {
      // Actualizar estado a Cliente activo
      await this.updateRecord('CRM', existing, {
        'Estado cuenta': 'Cliente activo',
        'Estado pipeline': 'Ganado',
      });
      return existing;
    }

    const res = await fetch(`${this.baseUrl}/v0/${this.erpBaseId}/CRM`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as any;
    if (!res.ok) throw new Error(`CRM create failed: ${JSON.stringify(json)}`);
    return json.id;
  }

  private async createProject(data: RegisterClientDto, crmId: string): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const year = new Date().getFullYear();
    const code = data.external_ref ?? `${year}-PROJ-${data.company_name.substring(0, 6).toUpperCase().replace(/\s/g, '')}`;

    // Verificar si ya existe un proyecto con ese código
    const existing = await this.findRecordByField('Proyectos', 'Codigo proyecto', code);
    if (existing) return existing;

    const body = {
      fields: {
        'Codigo proyecto': code,
        Estado: 'Setup',
        Tipo: 'AIMA',
        Contacto: [crmId],
        'Fecha kickoff': today,
      },
    };

    const res = await fetch(`${this.baseUrl}/v0/${this.erpBaseId}/Proyectos`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as any;
    if (!res.ok) throw new Error(`Proyecto create failed: ${JSON.stringify(json)}`);
    return json.id;
  }

  // ── 2. Crear base Airtable propia para el cliente ─────────────────────────────

  async createClientBase(tenantName: string, tableNames: Record<string, string> = {}): Promise<string | null> {
    if (!this.pat) {
      this.logger.warn('AIRTABLE_PAT no configurado. No se puede crear base cliente.');
      return null;
    }

    try {
      const tables = this.buildClientERPSchema(tableNames);

      const res = await fetch(`${this.baseUrl}/v0/meta/bases`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          name: `ERP — ${tenantName}`,
          tables,
        }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(`Base create failed: ${JSON.stringify(json)}`);

      this.logger.log(`Base Airtable creada para "${tenantName}": ${json.id}`);
      return json.id as string;
    } catch (err: any) {
      this.logger.error(`Error creando base Airtable para "${tenantName}": ${err.message}`);
      return null;
    }
  }

  private buildClientERPSchema(tableNames: Record<string, string> = {}): AirtableTableDef[] {
    const n = (key: string, defaultName: string) => tableNames[key] ?? defaultName;
    const select = (choices: string[]) => ({
      choices: choices.map(name => ({ name })),
    });

    return [
      {
        name: n('crm', 'CRM'),
        fields: [
          { name: 'Nombre contacto', type: 'singleLineText' },
          { name: 'Email', type: 'email' },
          { name: 'Empresa', type: 'singleLineText' },
          { name: 'Teléfono', type: 'phoneNumber' },
          {
            name: 'Estado cuenta',
            type: 'singleSelect',
            options: select(['Prospecto', 'Cliente activo', 'Inactivo', 'Exalumno']),
          },
          {
            name: 'Estado pipeline',
            type: 'singleSelect',
            options: select(['Nuevo', 'Contactado', 'Demo', 'Propuesta enviada', 'Negociación', 'Cerrado']),
          },
          { name: 'Notas', type: 'multilineText' },
        ],
      },
      {
        name: n('propuestas', 'Propuestas'),
        fields: [
          { name: 'Titulo', type: 'singleLineText' },
          {
            name: 'Tipo',
            type: 'singleSelect',
            options: select(['Auditoria', 'Setup', 'Retainer', 'Implementacion', 'Custom']),
          },
          { name: 'Contacto', type: 'singleLineText' },
          { name: 'Fecha', type: 'date', options: { dateFormat: { name: 'iso' } } },
          { name: 'Fecha cierre', type: 'date', options: { dateFormat: { name: 'iso' } } },
          {
            name: 'Estado',
            type: 'singleSelect',
            options: select(['En proceso', 'Enviada', 'Revisión', 'Ganada', 'Perdida']),
          },
          { name: 'Monto', type: 'currency', options: { precision: 2, symbol: '$' } },
          { name: 'URL propuesta', type: 'url' },
          { name: 'Notas', type: 'multilineText' },
        ],
      },
      {
        name: n('proyectos', 'Proyectos'),
        fields: [
          { name: 'Codigo proyecto', type: 'singleLineText' },
          {
            name: 'Tipo',
            type: 'singleSelect',
            options: select(['AIMA Setup', 'Auditoria IA', 'Implementacion F1', 'Retainer', 'Consultoria puntual']),
          },
          {
            name: 'Estado',
            type: 'singleSelect',
            options: select(['Borrador', 'Firmado', 'En progreso', 'En pausa', 'Completado', 'Cancelado']),
          },
          { name: 'Contacto', type: 'singleLineText' },
          { name: 'Fecha kickoff', type: 'date', options: { dateFormat: { name: 'iso' } } },
          { name: 'Fecha fin estimado', type: 'date', options: { dateFormat: { name: 'iso' } } },
          { name: 'Setup fee', type: 'currency', options: { precision: 2, symbol: '$' } },
          { name: 'Recurrencia mensual', type: 'currency', options: { precision: 2, symbol: '$' } },
          { name: 'Notas', type: 'multilineText' },
        ],
      },
      {
        name: n('pagos', 'Pagos'),
        fields: [
          { name: 'N factura', type: 'singleLineText' },
          { name: 'Monto', type: 'currency', options: { precision: 2, symbol: '$' } },
          {
            name: 'Estado',
            type: 'singleSelect',
            options: select(['Pendiente', 'Enviada', 'Cobrada', 'Vencida']),
          },
          { name: 'Fecha', type: 'date', options: { dateFormat: { name: 'iso' } } },
          { name: 'Concepto', type: 'singleLineText' },
          { name: 'Proyecto', type: 'singleLineText' },
          { name: 'Contacto', type: 'singleLineText' },
        ],
      },
      {
        name: n('interacciones', 'Interacciones'),
        fields: [
          { name: 'Titulo', type: 'singleLineText' },
          {
            name: 'Tipo',
            type: 'singleSelect',
            options: select(['Reunión', 'Llamada', 'Email', 'WhatsApp', 'Demo', 'Seguimiento', 'Otro']),
          },
          { name: 'Contacto', type: 'singleLineText' },
          { name: 'Fecha', type: 'date', options: { dateFormat: { name: 'iso' } } },
          { name: 'Fecha siguiente accion', type: 'date', options: { dateFormat: { name: 'iso' } } },
          { name: 'Siguiente accion', type: 'singleLineText' },
          { name: 'Responsable', type: 'singleLineText' },
          { name: 'Notas', type: 'multilineText' },
        ],
      },
    ];
  }

  // ── Helpers REST ─────────────────────────────────────────────────────────────

  private async findRecordByField(table: string, field: string, value: string): Promise<string | null> {
    const filter = encodeURIComponent(`{${field}} = "${value}"`);
    const res = await fetch(
      `${this.baseUrl}/v0/${this.erpBaseId}/${encodeURIComponent(table)}?filterByFormula=${filter}&maxRecords=1`,
      { headers: this.headers() },
    );
    const json = (await res.json()) as any;
    if (!res.ok) return null;
    return json.records?.[0]?.id ?? null;
  }

  private async updateRecord(table: string, recordId: string, fields: Record<string, unknown>): Promise<void> {
    await fetch(`${this.baseUrl}/v0/${this.erpBaseId}/${encodeURIComponent(table)}/${recordId}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({ fields }),
    });
  }
}
