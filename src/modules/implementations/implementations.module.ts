import { Module } from '@nestjs/common';
import { ImplementationsController } from './implementations.controller';
import { ImplementationsService } from './implementations.service';
import { ImplementationAgentService } from './implementation-agent.service';
import { AiModule } from '../../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [ImplementationsController],
  providers: [ImplementationsService, ImplementationAgentService],
  exports: [ImplementationsService],
})
export class ImplementationsModule {}
