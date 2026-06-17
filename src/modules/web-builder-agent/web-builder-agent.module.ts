import { Module } from '@nestjs/common';
import { WebBuilderAgentService } from './web-builder-agent.service';
import { WebBuilderAgentController } from './web-builder-agent.controller';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [PresenceModule],
  controllers: [WebBuilderAgentController],
  providers: [WebBuilderAgentService],
  exports: [WebBuilderAgentService],
})
export class WebBuilderAgentModule {}
