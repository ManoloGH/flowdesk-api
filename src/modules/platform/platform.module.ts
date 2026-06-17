import { Module } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { TenantExportService } from './tenant-export.service';
import { MigrationAuditService } from './migration-audit.service';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, TenantExportService, MigrationAuditService],
  exports: [PlatformService],
})
export class PlatformModule {}
