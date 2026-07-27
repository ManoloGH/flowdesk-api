import { Test, TestingModule } from '@nestjs/testing';
import { BusinessRulesService } from '../business-rules.service';
import { PrismaService } from '../../../database/prisma.service';
import { AiProviderService } from '../../../ai/ai-provider.service';

const mockRule = {
  id: 'rule-001',
  tenant_id: 'tenant-soc',
  name: 'Regla de aforo hipotecario',
  description: 'El aforo máximo permitido es 90% del valor del inmueble',
  category: 'REGLA_NEGOCIO',
  affected_areas: ['Hipotecaria'],
  related_systems: ['SISEC'],
  original_text: null,
  source_file_name: null,
  source: 'MANUAL',
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockPrisma = {
  businessRule: {
    findMany: jest.fn().mockResolvedValue([mockRule]),
    findFirst: jest.fn().mockResolvedValue(mockRule),
    create: jest.fn().mockResolvedValue(mockRule),
    update: jest.fn().mockResolvedValue({ ...mockRule, is_active: false }),
    delete: jest.fn().mockResolvedValue(mockRule),
  },
};

const AI_RESPONSE = `\`\`\`json
{
  "rules": [
    {
      "name": "Aforo máximo hipotecario",
      "description": "El préstamo no puede exceder el 90% del valor del inmueble",
      "category": "REGLA_NEGOCIO",
      "affected_areas": ["Hipotecaria", "Riesgo"],
      "related_systems": ["SISEC"],
      "original_text": "Aforo máximo hipotecario: 90%"
    },
    {
      "name": "Plazo mínimo PYME",
      "description": "Los créditos PYME tienen un plazo mínimo de 12 meses",
      "category": "POLITICA_OPERATIVA",
      "affected_areas": ["Pymes"],
      "related_systems": ["SISEC"],
      "original_text": "Plazo mínimo PYME: 12 meses"
    }
  ]
}
\`\`\``;

const mockAiProvider = {
  chat: jest.fn().mockResolvedValue(AI_RESPONSE),
};

describe('BusinessRulesService', () => {
  let service: BusinessRulesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessRulesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiProviderService, useValue: mockAiProvider },
      ],
    }).compile();

    service = module.get<BusinessRulesService>(BusinessRulesService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('retorna reglas activas del tenant', async () => {
      mockPrisma.businessRule.findMany.mockResolvedValue([mockRule]);
      const result = await service.findAll('tenant-soc');
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('REGLA_NEGOCIO');
    });
  });

  describe('create', () => {
    it('crea una regla con source MANUAL', async () => {
      mockPrisma.businessRule.create.mockResolvedValue(mockRule);
      await service.create('tenant-soc', {
        name: 'Aforo máximo',
        description: 'No puede exceder el 90%',
        category: 'REGLA_NEGOCIO' as any,
      });
      expect(mockPrisma.businessRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'MANUAL', tenant_id: 'tenant-soc' }),
        }),
      );
    });
  });

  describe('toggleActive', () => {
    it('invierte el estado is_active de la regla', async () => {
      mockPrisma.businessRule.findFirst.mockResolvedValue(mockRule);
      mockPrisma.businessRule.update.mockResolvedValue({ ...mockRule, is_active: false });

      const result = await service.toggleActive('tenant-soc', 'rule-001');
      expect(result.is_active).toBe(false);
      expect(mockPrisma.businessRule.update).toHaveBeenCalledWith({
        where: { id: 'rule-001' },
        data: { is_active: false },
      });
    });
  });

  describe('importFromText', () => {
    it('llama al agente IA y crea las reglas extraídas', async () => {
      mockAiProvider.chat.mockResolvedValue(AI_RESPONSE);
      mockPrisma.businessRule.create.mockImplementation((args: any) =>
        Promise.resolve({ ...mockRule, name: args.data.name, id: `rule-${Date.now()}` }),
      );

      const result = await service.importFromText('tenant-soc', {
        content: 'Aforo máximo hipotecario: 90%\nPlazo mínimo PYME: 12 meses',
        source_file_name: 'Políticas-2026.pdf',
      });

      expect(mockAiProvider.chat).toHaveBeenCalledTimes(1);
      expect(result.imported).toBe(2);
      expect(result.rules).toHaveLength(2);
      expect(mockPrisma.businessRule.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.businessRule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'ARCHIVO_IMPORTADO',
            source_file_name: 'Políticas-2026.pdf',
            tenant_id: 'tenant-soc',
          }),
        }),
      );
    });

    it('retorna 0 reglas si el agente no puede extraer nada válido', async () => {
      mockAiProvider.chat.mockResolvedValue('No pude extraer reglas.');
      const result = await service.importFromText('tenant-soc', { content: 'texto sin estructura' });
      expect(result.imported).toBe(0);
    });
  });
});
