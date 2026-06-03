import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { EncryptionModule } from '../../common/encryption/encryption.module';
import { AsteriskService } from './asterisk.service';
import { CallRouterService } from './call-router.service';
import { AiCallHandlerService } from './ai-call-handler.service';
import { PbxService } from './pbx.service';
import { PbxController } from './pbx.controller';

@Module({
  imports: [PrismaModule, EncryptionModule],
  providers: [AsteriskService, CallRouterService, AiCallHandlerService, PbxService],
  controllers: [PbxController],
  exports: [PbxService],
})
export class PbxModule {}
