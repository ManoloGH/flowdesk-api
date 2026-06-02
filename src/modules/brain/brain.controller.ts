import { Controller, Get, Post, Delete, Body, Param, Query, Request, UseGuards } from '@nestjs/common';
import { BrainService, BrainDocumentInput } from './brain.service';
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
  constructor(private readonly brain: BrainService) {}

  @Post('documents')
  @Roles('owner', 'admin')
  add(@Request() req: any, @Body() dto: AddDocumentDto) {
    return this.brain.addDocument(req.user.tenant_id, dto).then(id => ({ id }));
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

  @Delete('documents/:sourceType/:sourceId')
  @Roles('owner', 'admin')
  remove(@Request() req: any, @Param('sourceType') sourceType: string, @Param('sourceId') sourceId: string) {
    return this.brain.deleteBySource(req.user.tenant_id, sourceType, sourceId);
  }
}
