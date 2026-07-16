import { Module } from '@nestjs/common';
import { SocCatalogController } from './soc-catalog.controller';
import { SocCatalogService } from './soc-catalog.service';
import { SocRequestsController } from './soc-requests.controller';
import { SocRequestsService } from './soc-requests.service';

@Module({
  controllers: [SocCatalogController, SocRequestsController],
  providers: [SocCatalogService, SocRequestsService],
  exports: [SocCatalogService, SocRequestsService],
})
export class SocModule {}
