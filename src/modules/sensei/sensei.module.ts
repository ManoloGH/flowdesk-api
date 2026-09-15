import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { SenseiController } from './sensei.controller';
import { SenseiService } from './sensei.service';

@Module({
  imports: [PrismaModule],
  controllers: [SenseiController],
  providers: [SenseiService],
  exports: [SenseiService],
})
export class SenseiModule {}
