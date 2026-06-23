import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformService } from './platform.service';
import { PlatformController } from './platform.controller';
import { TenantExportService } from './tenant-export.service';
import { MigrationAuditService } from './migration-audit.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PlatformController],
  providers: [PlatformService, TenantExportService, MigrationAuditService],
  exports: [PlatformService],
})
export class PlatformModule {}
