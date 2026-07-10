import { Module } from '@nestjs/common';
import { ClienteDocsController } from './cliente-docs.controller';
import { ClienteDocsService } from './cliente-docs.service';

@Module({
  controllers: [ClienteDocsController],
  providers: [ClienteDocsService],
})
export class ClienteDocsModule {}
