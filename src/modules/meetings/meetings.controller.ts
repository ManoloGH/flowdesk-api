import { Controller, Get, Post, Param, Body, Request } from '@nestjs/common';
import { MeetingsService } from './meetings.service';

@Controller()
export class MeetingsController {
  constructor(private meetings: MeetingsService) {}

  // Deepgram key para que el frontend conecte directamente al WS
  @Get('meetings/key')
  getKey() {
    return this.meetings.getDeepgramKey();
  }

  @Post('meetings')
  save(@Request() req: any, @Body() body: any) {
    return this.meetings.save(req.user.tenant_id, req.user.sub, body);
  }

  @Get('meetings')
  list(@Request() req: any) {
    return this.meetings.list(req.user.tenant_id);
  }

  @Get('meetings/:id')
  get(@Request() req: any, @Param('id') id: string) {
    return this.meetings.get(req.user.tenant_id, id);
  }
}
