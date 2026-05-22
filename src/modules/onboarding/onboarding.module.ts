import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingAgentService } from './onboarding-agent.service';
import { OnboardingController } from './onboarding.controller';
import { AirtableModule } from '../airtable/airtable.module';
import { GoalsModule } from '../goals/goals.module';
import { CultureModule } from '../culture/culture.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AirtableModule, GoalsModule, CultureModule, IntegrationsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingAgentService],
  exports: [OnboardingService, OnboardingAgentService],
})
export class OnboardingModule {}
