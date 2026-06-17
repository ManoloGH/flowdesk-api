import { Module } from '@nestjs/common';
import { AgentLearningService } from './agent-learning.service';
import { AgentLearningController } from './agent-learning.controller';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [AgentLearningService],
  controllers: [AgentLearningController],
  exports: [AgentLearningService],
})
export class AgentLearningModule {}
