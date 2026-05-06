import { Module } from '@nestjs/common';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentConversationsController } from './agent-conversations.controller';
import { AgentMemoryModule } from '../agent-memory/agent-memory.module';

@Module({
  imports: [AgentMemoryModule],
  controllers: [AgentConversationsController],
  providers: [AgentConversationsService],
  exports: [AgentConversationsService],
})
export class AgentConversationsModule {}
