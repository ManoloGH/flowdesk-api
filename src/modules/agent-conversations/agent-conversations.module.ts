import { Module } from '@nestjs/common';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentConversationsController } from './agent-conversations.controller';
import { AgentMemoryModule } from '../agent-memory/agent-memory.module';
import { GoalsModule } from '../goals/goals.module';
import { CultureModule } from '../culture/culture.module';

@Module({
  imports: [AgentMemoryModule, GoalsModule, CultureModule],
  controllers: [AgentConversationsController],
  providers: [AgentConversationsService],
  exports: [AgentConversationsService],
})
export class AgentConversationsModule {}
