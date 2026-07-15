import { Module } from '@nestjs/common';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { BotConversationsService } from './bot-conversations.service';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, BotConversationsService],
  exports: [BotConversationsService],
})
export class CommunicationsModule {}
