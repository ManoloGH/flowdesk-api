import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class GhlAdapter {
  private readonly logger = new Logger(GhlAdapter.name);
  private readonly baseUrl = 'https://services.leadconnectorhq.com';
  private readonly apiKey = process.env.GHL_API_KEY ?? '';
  private readonly locationId = process.env.GHL_LOCATION_ID ?? '';

  constructor(private prisma: PrismaService) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
    };
  }

  // Buscar contacto en GHL por teléfono o email
  async findContact(query: string) {
    const url = `${this.baseUrl}/contacts/search/duplicate?locationId=${this.locationId}&number=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: this.headers() });
    return res.json();
  }

  // Crear contacto en GHL
  async createContact(data: {
    firstName: string;
    lastName?: string;
    email?: string;
    phone?: string;
    tags?: string[];
  }) {
    const res = await fetch(`${this.baseUrl}/contacts/`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ...data, locationId: this.locationId }),
    });
    if (!res.ok) this.logger.error(`GHL createContact error: ${res.status}`);
    return res.json();
  }

  // Actualizar contacto en GHL
  async updateContact(ghlId: string, data: Record<string, any>) {
    const res = await fetch(`${this.baseUrl}/contacts/${ghlId}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    return res.json();
  }

  // Obtener oportunidades (deals) de GHL
  async getOpportunities(pipelineId?: string) {
    const params = new URLSearchParams({ location_id: this.locationId });
    if (pipelineId) params.append('pipeline_id', pipelineId);
    const res = await fetch(`${this.baseUrl}/opportunities/search?${params}`, {
      headers: this.headers(),
    });
    return res.json();
  }

  // Actualizar etapa de oportunidad en GHL
  async updateOpportunityStage(opportunityId: string, stageId: string) {
    const res = await fetch(`${this.baseUrl}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ pipelineStageId: stageId }),
    });
    return res.json();
  }

  // Obtener disponibilidad del calendario de GHL
  async getCalendarSlots(calendarId: string, startDate: string, endDate: string) {
    const url = `${this.baseUrl}/calendars/${calendarId}/free-slots?startDate=${startDate}&endDate=${endDate}&timezone=America/Mexico_City`;
    const res = await fetch(url, { headers: this.headers() });
    return res.json();
  }

  // Crear cita en GHL
  async createAppointment(data: {
    calendarId: string;
    contactId: string;
    startTime: string;
    endTime: string;
    title: string;
  }) {
    const res = await fetch(`${this.baseUrl}/calendars/events/appointments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ...data, locationId: this.locationId }),
    });
    return res.json();
  }

  // Procesar webhook de GHL y sincronizar con FlowDesk
  async processWebhook(payload: any, tenantId: string) {
    const { type, locationId, id: ghlContactId } = payload;

    if (type === 'ContactCreate' || type === 'ContactUpdate') {
      const existing = await this.prisma.contact.findFirst({
        where: { tenant_id: tenantId, ghl_id: String(ghlContactId) },
      });

      const contactData = {
        first_name: payload.firstName ?? 'Contacto',
        last_name: payload.lastName,
        email: payload.email,
        phone: payload.phone,
        ghl_id: String(ghlContactId),
        last_contact_at: new Date(),
      };

      if (existing) {
        await this.prisma.contact.update({ where: { id: existing.id }, data: contactData });
      } else {
        await this.prisma.contact.create({
          data: { tenant_id: tenantId, status: 'lead', ...contactData },
        });
      }
    }

    if (type === 'OpportunityStageUpdate') {
      this.logger.log(`GHL OpportunityStageUpdate: ${payload.id} → ${payload.pipelineStageId}`);
      // Aquí se actualizaría el deal correspondiente en FlowDesk
    }
  }
}
