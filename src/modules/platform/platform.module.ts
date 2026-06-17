import { Module } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { TenantExportService } from './tenant-export.service';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, TenantExportService],
  exports: [PlatformService],
})
export class PlatformModule {}
