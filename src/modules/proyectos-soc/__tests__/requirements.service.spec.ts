import { Test, TestingModule } from '@nestjs/testing';
import { RequirementsService } from '../requirements.service';
import { PrismaService } from '../../../database/prisma.service';
import { AiProviderService } from '../../../ai/ai-provider.service';

const mockRequirement = {
  id: 'req-001',
  folio: 'REQ-SOC-2026-0001',
  tenant_id: 'tenant-soc',
  title: 'Automatización de cartera hipotecaria',
  status: 'BORRADOR',
  doc_type: 'MEJORA',
  doc_version: '1.0',
  intake_source: 'FORMULARIO',
  current_situation: null,
  problem_statement: null,
  objective: null,
  business_policies: null,
  related_systems: null,
  sisec_integrations: null,
  event_triggers: null,
  libreta_notes: null,
  committed_dates: null,
  scope: null,
  out_of_scope: null,
  assumptions: null,
  constraints: null,
  requested_by: 'Ana García',
  requested_by_email: 'ana@soc.mx',
  responsible_systems: null,
  responsible_business: null,
  estimated_effort_days: null,
  estimated_duration: null,
  start_date: null,
  due_date: null,
  excel_upload_id: null,
  pm_slot_id: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockPrisma = {
  requirement: {
    findMany: jest.fn().mockResolvedValue([mockRequirement]),
    findFirst: jest.fn().mockResolvedValue(mockRequirement),
    create: jest.fn().mockResolvedValue(mockRequirement),
    update: jest.fn().mockResolvedValue(mockRequirement),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue(mockRequirement),
  },
  businessRule: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  requirementHistory: {
    create: jest.fn().mockResolvedValue({ id: 'hist-001' }),
  },
};

const mockAiProvider = {
  chat: jest.fn().mockResolvedValue(JSON.stringify({
    title: 'Automatización de cartera hipotecaria',
    current_situation: 'Actualmente el proceso es manual',
    problem_statement: 'Se pierde tiempo en reportes manuales',
    objective: 'Automatizar la generación de reportes',
    business_policies: 'Los reportes deben generarse al cierre del día',
    related_systems: 'SISEC, Excel Marketing',
    sisec_integrations: [{ data_name: 'id_credito', direction: 'READ', sync_frequency: 'REALTIME' }],
    event_triggers: [],
    libreta_notes: 'El asesor anota el monto aprobado manualmente',
    scope: 'Generación de reporte PDF',
    out_of_scope: 'Integración con bancos',
    assumptions: 'SISEC tiene API activa',
    constraints: 'Debe completar en menos de 5 segundos',
  })),
};

describe('RequirementsService', () => {
  let service: RequirementsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequirementsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiProviderService, useValue: mockAiProvider },
      ],
    }).compile();

    service = module.get<RequirementsService>(RequirementsService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('retorna lista de requerimientos del tenant', async () => {
      mockPrisma.requirement.findMany.mockResolvedValue([mockRequirement]);
      const result = await service.findAll('tenant-soc');
      expect(result).toHaveLength(1);
      expect(result[0].folio).toBe('REQ-SOC-2026-0001');
      expect(mockPrisma.requirement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-soc' }) }),
      );
    });

    it('aplica filtro de status cuando se proporciona', async () => {
      await service.findAll('tenant-soc', { status: 'APROBADO' });
      expect(mockPrisma.requirement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'APROBADO' }) }),
      );
    });
  });

  describe('findOne', () => {
    it('retorna el requerimiento cuando existe y pertenece al tenant', async () => {
      mockPrisma.requirement.findFirst.mockResolvedValue({ ...mockRequirement, history: [], sisec_items: [] });
      const result = await service.findOne('tenant-soc', 'req-001');
      expect(result.id).toBe('req-001');
    });

    it('lanza NotFoundException cuando no existe', async () => {
      mockPrisma.requirement.findFirst.mockResolvedValue(null);
      await expect(service.findOne('tenant-soc', 'req-999')).rejects.toThrow('Requerimiento no encontrado');
    });
  });

  describe('create', () => {
    it('genera folio incremental y crea el requerimiento', async () => {
      mockPrisma.requirement.count.mockResolvedValue(5);
      mockPrisma.requirement.create.mockResolvedValue({ ...mockRequirement, folio: 'REQ-SOC-2026-0006' });
      mockPrisma.requirementHistory.create.mockResolvedValue({ id: 'h1' });

      const result = await service.create('tenant-soc', 'slot-001', {
        title: 'Nuevo requerimiento de prueba',
      });

      expect(result.folio).toBe('REQ-SOC-2026-0006');
      expect(mockPrisma.requirementHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'created' }) }),
      );
    });
  });

  describe('generateDocument', () => {
    it('llama al agente IA y actualiza el requerimiento con el documento generado', async () => {
      mockPrisma.requirement.findFirst.mockResolvedValue(mockRequirement);
      mockPrisma.businessRule.findMany.mockResolvedValue([]);
      mockPrisma.requirement.update.mockResolvedValue({ ...mockRequirement, doc_version: '1.1', current_situation: 'Actualmente el proceso es manual' });
      mockPrisma.requirementHistory.create.mockResolvedValue({ id: 'h2' });

      mockAiProvider.chat.mockResolvedValue(`\`\`\`json
{
  "title": "Automatización de cartera hipotecaria",
  "current_situation": "Actualmente el proceso es manual",
  "problem_statement": "Se pierde tiempo en reportes manuales",
  "objective": "Automatizar la generación de reportes",
  "business_policies": null,
  "related_systems": "SISEC",
  "sisec_integrations": [],
  "event_triggers": [],
  "libreta_notes": "El asesor anota el monto",
  "scope": "Generación de reporte",
  "out_of_scope": null,
  "assumptions": null,
  "constraints": null
}
\`\`\``);

      const result = await service.generateDocument('tenant-soc', 'slot-001', 'req-001', { include_rules: true });

      expect(mockAiProvider.chat).toHaveBeenCalledTimes(1);
      expect(mockAiProvider.chat).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-soc',
        agentRole: 'ceo',
      }));
      expect(mockPrisma.requirement.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-001' } }),
      );
      expect(result.doc_version).toBe('1.1');
    });
  });

  describe('updateStatus', () => {
    it('cambia el estado y registra en historial', async () => {
      mockPrisma.requirement.findFirst.mockResolvedValue(mockRequirement);
      mockPrisma.requirement.update.mockResolvedValue({ ...mockRequirement, status: 'APROBADO' });
      mockPrisma.requirementHistory.create.mockResolvedValue({ id: 'h3' });

      const result = await service.updateStatus('tenant-soc', 'slot-001', 'req-001', { status: 'APROBADO' as any });

      expect(result.status).toBe('APROBADO');
      expect(mockPrisma.requirementHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'status_changed', from_value: 'BORRADOR', to_value: 'APROBADO' }),
        }),
      );
    });
  });
});
