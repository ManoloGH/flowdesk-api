import { Controller, Get, Post, Delete, Body, Param, Query, Request, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BrainService, BrainDocumentInput } from './brain.service';
import { BrainUploadService } from './brain-upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

class AddDocumentDto implements BrainDocumentInput {
  source_type: string;
  source_id?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

class SearchDto {
  query: string;
  limit?: number;
  source_type?: string;
  threshold?: number;
}

@Controller('brain')
@UseGuards(JwtAuthGuard)
export class BrainController {
  constructor(
    private readonly brain: BrainService,
    private readonly upload: BrainUploadService,
  ) {}

  @Post('documents')
  @Roles('owner', 'admin')
  add(@Request() req: any, @Body() dto: AddDocumentDto) {
    return this.brain.addDocument(req.user.tenant_id, dto).then(id => ({ id }));
  }

  @Post('upload')
  @Roles('owner', 'admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async uploadFile(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('hint') hint?: string,
  ) {
    if (!file) throw new BadRequestException('Se requiere un archivo (campo: file)');

    const extracted = await this.upload.extractFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname,
      hint,
    );

    const id = await this.brain.addDocument(req.user.tenant_id, {
      title:       extracted.title,
      content:     extracted.content,
      source_type: extracted.source_type,
      source_id:   `upload_${Date.now()}`,
      metadata: {
        original_name: file.originalname,
        mimetype:      file.mimetype,
        size_bytes:    file.size,
        uploaded_at:   new Date().toISOString(),
      },
    });

    return {
      id,
      title:       extracted.title,
      source_type: extracted.source_type,
      size_bytes:  file.size,
      mimetype:    file.mimetype,
    };
  }

  @Post('search')
  search(@Request() req: any, @Body() dto: SearchDto) {
    return this.brain.search(req.user.tenant_id, dto.query, {
      limit:       dto.limit,
      source_type: dto.source_type,
      threshold:   dto.threshold,
    });
  }

  @Get('documents')
  list(@Request() req: any, @Query('source_type') sourceType?: string) {
    return this.brain.list(req.user.tenant_id, sourceType);
  }

  @Get('stats')
  stats(@Request() req: any) {
    return this.brain.getStats(req.user.tenant_id);
  }

  @Post('reindex')
  @Roles('owner', 'admin')
  reindex(@Request() req: any) {
    return this.brain.reindex(req.user.tenant_id);
  }

  @Delete('documents/:sourceType/:sourceId')
  @Roles('owner', 'admin')
  remove(@Request() req: any, @Param('sourceType') sourceType: string, @Param('sourceId') sourceId: string) {
    return this.brain.deleteBySource(req.user.tenant_id, sourceType, sourceId);
  }
}
