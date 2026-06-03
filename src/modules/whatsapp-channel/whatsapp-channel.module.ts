import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { AgentConversationsModule } from '../agent-conversations/agent-conversations.module';
import { WhatsAppRouterService } from './whatsapp-router.service';
import { EmployeeWhatsAppService } from './employee-whatsapp.service';
import { CustomerWhatsAppService } from './customer-whatsapp.service';
import { WhatsAppFormatterService } from './whatsapp-formatter.service';

@Module({
  imports: [PrismaModule, IntegrationsModule, AgentConversationsModule],
  providers: [
    WhatsAppRouterService,
    EmployeeWhatsAppService,
    CustomerWhatsAppService,
    WhatsAppFormatterService,
  ],
  exports: [WhatsAppRouterService, EmployeeWhatsAppService, CustomerWhatsAppService],
})
export class WhatsAppChannelModule {}
