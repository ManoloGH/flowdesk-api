import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AgentCalibrationModule } from '../agent-calibration/agent-calibration.module';
import { AgentEvolutionModule } from '../agent-evolution/agent-evolution.module';
import { AgentPanelController } from './agent-panel.controller';
import { AgentPanelService } from './agent-panel.service';

@Module({
  imports: [PrismaModule, AgentCalibrationModule, AgentEvolutionModule],
  controllers: [AgentPanelController],
  providers: [AgentPanelService],
  exports: [AgentPanelService],
})
export class AgentPanelModule {}
