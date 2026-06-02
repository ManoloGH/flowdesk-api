import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { MessagesModule } from '../messages/messages.module';
import { SecretaryModule } from '../secretary/secretary.module';

@Module({
  imports: [MessagesModule, SecretaryModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
