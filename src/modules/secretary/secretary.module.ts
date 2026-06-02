import { Module } from '@nestjs/common';
import { SecretaryService } from './secretary.service';
import { SecretaryAgentService } from './secretary-agent.service';
import { SecretaryController } from './secretary.controller';
import { WhatsAppService } from './whatsapp.service';
import { BrainModule } from '../brain/brain.module';

@Module({
  imports: [BrainModule],
  controllers: [SecretaryController],
  providers: [SecretaryService, SecretaryAgentService, WhatsAppService],
  exports: [SecretaryService, SecretaryAgentService, WhatsAppService],
})
export class SecretaryModule {}
