import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingAgentService } from './onboarding-agent.service';
import { OnboardingController } from './onboarding.controller';
import { DocumentParserService } from './document-parser.service';
import { AirtableModule } from '../airtable/airtable.module';
import { GoalsModule } from '../goals/goals.module';
import { CultureModule } from '../culture/culture.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SecretaryModule } from '../secretary/secretary.module';

@Module({
  imports: [AirtableModule, GoalsModule, CultureModule, IntegrationsModule, SecretaryModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, OnboardingAgentService, DocumentParserService],
  exports: [OnboardingService, OnboardingAgentService, DocumentParserService],
})
export class OnboardingModule {}
