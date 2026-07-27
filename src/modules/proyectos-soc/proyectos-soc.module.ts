import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';
import { BusinessRulesController } from './business-rules.controller';
import { BusinessRulesService } from './business-rules.service';
import { ExcelIntakeController } from './excel-intake.controller';
import { ExcelIntakeService } from './excel-intake.service';

@Module({
  imports: [AiModule],
  controllers: [RequirementsController, BusinessRulesController, ExcelIntakeController],
  providers: [RequirementsService, BusinessRulesService, ExcelIntakeService],
  exports: [RequirementsService, BusinessRulesService, ExcelIntakeService],
})
export class ProyectosSocModule {}
