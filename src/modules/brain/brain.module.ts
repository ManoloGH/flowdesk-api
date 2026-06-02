import { Module } from '@nestjs/common';
import { BrainService } from './brain.service';
import { BrainController } from './brain.controller';
import { EmbeddingService } from './embedding.service';

@Module({
  controllers: [BrainController],
  providers: [BrainService, EmbeddingService],
  exports: [BrainService, EmbeddingService],
})
export class BrainModule {}
