import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../../database/prisma.module';
import { GoalsController } from './goals.controller';
import { KsfService } from './services/ksf.service';
import { MeasurementCalculatorService } from './services/measurement-calculator.service';
import { ReportGeneratorService } from './services/report-generator.service';
import { RecognitionService } from './services/recognition.service';
import { GoalAlignmentService } from './services/goal-alignment.service';
import { GoalSchedulerService } from './scheduler/goal-scheduler.service';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [GoalsController],
  providers: [
    KsfService,
    MeasurementCalculatorService,
    ReportGeneratorService,
    RecognitionService,
    GoalAlignmentService,
    GoalSchedulerService,
  ],
  exports: [
    KsfService,
    ReportGeneratorService,
    GoalAlignmentService,
    RecognitionService,
  ],
})
export class GoalsModule {}
