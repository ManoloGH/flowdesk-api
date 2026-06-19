import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { PersonalAssistantModule } from '../personal-assistant/personal-assistant.module';
import { WhatsAppRouterService } from './whatsapp-router.service';
import { EmployeeWhatsAppService } from './employee-whatsapp.service';
import { OperativeWhatsAppService } from './operative-whatsapp.service';
import { CustomerWhatsAppService } from './customer-whatsapp.service';
import { WhatsAppFormatterService } from './whatsapp-formatter.service';

@Module({
  imports: [PrismaModule, IntegrationsModule, PersonalAssistantModule],
  providers: [
    WhatsAppRouterService,
    EmployeeWhatsAppService,
    OperativeWhatsAppService,
    CustomerWhatsAppService,
    WhatsAppFormatterService,
  ],
  exports: [
    WhatsAppRouterService,
    EmployeeWhatsAppService,
    OperativeWhatsAppService,
    CustomerWhatsAppService,
  ],
})
export class WhatsAppChannelModule {}
