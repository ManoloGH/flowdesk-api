import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { MessagesModule } from '../messages/messages.module';
import { SecretaryModule } from '../secretary/secretary.module';
import { WhatsAppChannelModule } from '../whatsapp-channel/whatsapp-channel.module';
import { ChatwootBridgeModule } from '../chatwoot-bridge/chatwoot-bridge.module';

@Module({
  imports: [MessagesModule, SecretaryModule, WhatsAppChannelModule, ChatwootBridgeModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
