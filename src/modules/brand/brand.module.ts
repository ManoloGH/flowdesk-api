import { Module } from '@nestjs/common';
import { BrandService } from './brand.service';

@Module({
  providers: [BrandService],
  exports:   [BrandService],
})
export class BrandModule {}
