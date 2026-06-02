import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesAgentService } from './sales-agent.service';
import { SalesController } from './sales.controller';

@Module({
  controllers: [SalesController],
  providers: [SalesService, SalesAgentService],
  exports: [SalesService, SalesAgentService],
})
export class SalesModule {}
