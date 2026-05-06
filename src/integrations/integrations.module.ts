import { Module, Global } from '@nestjs/common';
import { ChatwootAdapter } from './chatwoot/chatwoot.adapter';
import { EvolutionAdapter } from './evolution/evolution.adapter';
import { GhlAdapter } from './ghl/ghl.adapter';
import { M365Adapter } from './m365/m365.adapter';
import { GoogleAdapter } from './google/google.adapter';
import { IntegrationsController } from './integrations.controller';

@Global()
@Module({
  controllers: [IntegrationsController],
  providers: [ChatwootAdapter, EvolutionAdapter, GhlAdapter, M365Adapter, GoogleAdapter],
  exports: [ChatwootAdapter, EvolutionAdapter, GhlAdapter, M365Adapter, GoogleAdapter],
})
export class IntegrationsModule {}