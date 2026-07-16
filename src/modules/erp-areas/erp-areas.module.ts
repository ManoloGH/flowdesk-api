import { Module } from '@nestjs/common';
import { ErpAreasController } from './erp-areas.controller';
import { ErpAreasService } from './erp-areas.service';

@Module({
  controllers: [ErpAreasController],
  providers: [ErpAreasService],
  exports: [ErpAreasService],
})
export class ErpAreasModule {}
