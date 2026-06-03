import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AgentCalibrationService } from './agent-calibration.service';

@Module({
  imports: [PrismaModule],
  providers: [AgentCalibrationService],
  exports: [AgentCalibrationService],
})
export class AgentCalibrationModule {}
