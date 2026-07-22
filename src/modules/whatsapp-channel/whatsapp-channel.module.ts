import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { PersonalAssistantModule } from '../personal-assistant/personal-assistant.module';
import { WhatsAppRouterService } from './whatsapp-router.service';
import { EmployeeWhatsAppService } from './employee-whatsapp.service';
import { OperativeWhatsAppService } from './operative-whatsapp.service';
import { CustomerWhatsAppService } from './customer-whatsapp.service';
import { WhatsAppFormatterService } from './whatsapp-formatter.service';
import { SalesBotService } from './sales-bot.service';
import { SalesBotFollowUpService } from './sales-bot-followup.service';

@Module({
  imports: [PrismaModule, IntegrationsModule, PersonalAssistantModule],
  providers: [
    WhatsAppRouterService,
    EmployeeWhatsAppService,
    OperativeWhatsAppService,
    CustomerWhatsAppService,
    WhatsAppFormatterService,
    SalesBotService,
    SalesBotFollowUpService,
  ],
  exports: [
    WhatsAppRouterService,
    EmployeeWhatsAppService,
    OperativeWhatsAppService,
    CustomerWhatsAppService,
    SalesBotService,
  ],
})
export class WhatsAppChannelModule {}
