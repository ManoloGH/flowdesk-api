import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingAgentService } from './billing-agent.service';
import { BillingController } from './billing.controller';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [BillingService, BillingAgentService],
  controllers: [BillingController],
  exports: [BillingService, BillingAgentService],
})
export class BillingModule {}
