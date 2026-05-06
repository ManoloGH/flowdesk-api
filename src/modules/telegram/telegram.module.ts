import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { AgentConversationsModule } from '../agent-conversations/agent-conversations.module';

@Module({
  imports: [AgentConversationsModule],
  controllers: [TelegramController],
  providers: [TelegramService],
})
export class TelegramModule {}
