import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AgentCalibrationModule } from '../agent-calibration/agent-calibration.module';
import { AgentEvolutionService } from './agent-evolution.service';

@Module({
  imports: [PrismaModule, AgentCalibrationModule],
  providers: [AgentEvolutionService],
  exports: [AgentEvolutionService],
})
export class AgentEvolutionModule {}
