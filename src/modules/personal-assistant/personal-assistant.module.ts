import { Module } from '@nestjs/common';
import { PersonalAssistantController } from './personal-assistant.controller';
import { PersonalAssistantService } from './personal-assistant.service';
import { AiModule } from '../../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [PersonalAssistantController],
  providers: [PersonalAssistantService],
  exports: [PersonalAssistantService],
})
export class PersonalAssistantModule {}
