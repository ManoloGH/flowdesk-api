import { Module } from '@nestjs/common';
import { CultureService } from './culture.service';
import { CultureController } from './culture.controller';
import { CultureEngineService } from './culture-engine.service';
import { CultureEngineController } from './culture-engine.controller';
import { PrismaModule } from '../../database/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CultureController, CultureEngineController],
  providers: [CultureService, CultureEngineService],
  exports: [CultureService, CultureEngineService],
})
export class CultureModule {}
