import { Module, forwardRef } from '@nestjs/common';
import { SecretaryService } from './secretary.service';
import { SecretaryAgentService } from './secretary-agent.service';
import { SecretaryController } from './secretary.controller';
import { WhatsAppService } from './whatsapp.service';
import { BrainModule } from '../brain/brain.module';
import { AgentConversationsModule } from '../agent-conversations/agent-conversations.module';

@Module({
  imports: [BrainModule, forwardRef(() => AgentConversationsModule)],
  controllers: [SecretaryController],
  providers: [SecretaryService, SecretaryAgentService, WhatsAppService],
  exports: [SecretaryService, SecretaryAgentService, WhatsAppService],
})
export class SecretaryModule {}
