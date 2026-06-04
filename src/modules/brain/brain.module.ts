import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { BrainService } from './brain.service';
import { BrainController } from './brain.controller';
import { EmbeddingService } from './embedding.service';
import { BrainUploadService } from './brain-upload.service';

@Module({
  imports: [MulterModule.register({ limits: { fileSize: 20 * 1024 * 1024 } })],
  controllers: [BrainController],
  providers: [BrainService, EmbeddingService, BrainUploadService],
  exports: [BrainService, EmbeddingService, BrainUploadService],
})
export class BrainModule {}
