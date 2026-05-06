import { Module } from '@nestjs/common';
import { MapPropsService } from './map-props.service';
import { MapPropsController } from './map-props.controller';

@Module({
  controllers: [MapPropsController],
  providers: [MapPropsService],
  exports: [MapPropsService],
})
export class MapPropsModule {}
