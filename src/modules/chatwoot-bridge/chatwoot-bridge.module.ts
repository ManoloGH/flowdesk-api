import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { ChatwootBridgeService } from './chatwoot-bridge.service';

@Module({
  imports: [PrismaModule, IntegrationsModule],
  providers: [ChatwootBridgeService],
  exports: [ChatwootBridgeService],
})
export class ChatwootBridgeModule {}
