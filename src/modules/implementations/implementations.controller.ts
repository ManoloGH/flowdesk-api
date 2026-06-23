import { Controller, Get, Post, Patch, Delete, Body, Param, Req } from '@nestjs/common';
import { ImplementationsService } from './implementations.service';
import { ImplementationAgentService } from './implementation-agent.service';

@Controller('implementations')
export class ImplementationsController {
  constructor(
    private readonly service: ImplementationsService,
    private readonly agent: ImplementationAgentService,
  ) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.tenantId);
  }

  @Post()
  create(@Req() req: any, @Body() body: { client_name: string; client_info?: any }) {
    return this.service.create(req.user.tenantId, body);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.service.findOne(req.user.tenantId, id);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: { phase?: number; status?: string; client_info?: any }) {
    if (body.status === 'completed') {
      (body as any).completed_at = new Date();
    }
    return this.service.update(req.user.tenantId, id, body);
  }

  @Post(':id/checks')
  toggleCheck(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { check_id: string; phase: number; checked: boolean },
  ) {
    return this.service.toggleCheck(req.user.tenantId, id, body.check_id, body.phase, body.checked);
  }

  @Post(':id/notes')
  addNote(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { phase: number; content: string },
  ) {
    return this.service.addNote(req.user.tenantId, id, {
      ...body,
      created_by: req.user.slotId,
    });
  }

  @Delete(':id/notes/:noteId')
  deleteNote(@Req() req: any, @Param('id') id: string, @Param('noteId') noteId: string) {
    return this.service.deleteNote(req.user.tenantId, id, noteId);
  }

  @Post(':id/files')
  addFile(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { phase: number; name: string; url: string },
  ) {
    return this.service.addFile(req.user.tenantId, id, body);
  }

  @Delete(':id/files/:fileId')
  deleteFile(@Req() req: any, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.service.deleteFile(req.user.tenantId, id, fileId);
  }

  @Post(':id/chat')
  async chat(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { message: string },
  ) {
    const reply = await this.agent.chat(req.user.tenantId, id, body.message);
    return { reply };
  }

  @Get(':id/messages')
  getMessages(@Req() req: any, @Param('id') id: string) {
    return this.service.getMessages(req.user.tenantId, id);
  }
}
