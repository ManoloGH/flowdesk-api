import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { FocusBriefScheduler } from './focus-brief.scheduler';
import { BrandModule } from '../brand/brand.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports:     [BrandModule, PlatformModule],
  controllers: [TenantsController],
  providers:   [TenantsService, FocusBriefScheduler],
  exports:     [TenantsService],
})
export class TenantsModule {}
