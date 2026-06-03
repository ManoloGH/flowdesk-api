import { Module } from '@nestjs/common';
import { InstallationAgentService } from './installation-agent.service';
import { InstallationAgentController } from './installation-agent.controller';

@Module({
  providers: [InstallationAgentService],
  controllers: [InstallationAgentController],
})
export class InstallationAgentModule {}
