import { Module } from '@nestjs/common';
import { AgentConversationsService } from './agent-conversations.service';
import { AgentConversationsController } from './agent-conversations.controller';
import { AgentMemoryModule } from '../agent-memory/agent-memory.module';
import { GoalsModule } from '../goals/goals.module';
import { CultureModule } from '../culture/culture.module';
import { BrainModule } from '../brain/brain.module';
import { SalesModule } from '../sales/sales.module';
import { SecretaryModule } from '../secretary/secretary.module';

@Module({
  imports: [AgentMemoryModule, GoalsModule, CultureModule, BrainModule, SalesModule, SecretaryModule],
  controllers: [AgentConversationsController],
  providers: [AgentConversationsService],
  exports: [AgentConversationsService],
})
export class AgentConversationsModule {}
