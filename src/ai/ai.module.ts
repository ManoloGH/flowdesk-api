import { Global, Module } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';
import { PrismaModule } from '../database/prisma.module';
import { EncryptionModule } from '../common/encryption/encryption.module';

@Global()
@Module({
  imports: [PrismaModule, EncryptionModule],
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiModule {}
