import { Module } from '@nestjs/common';
import { AgentMemoryService } from './agent-memory.service';
import { AgentMemoryController } from './agent-memory.controller';

@Module({
  controllers: [AgentMemoryController],
  providers: [AgentMemoryService],
  exports: [AgentMemoryService],
})
export class AgentMemoryModule {}
