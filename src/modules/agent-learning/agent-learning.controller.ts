import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AgentLearningService } from './agent-learning.service';

@ApiTags('Agent Learning')
@ApiBearerAuth()
@Controller('agents/learning')
export class AgentLearningController {
  constructor(private service: AgentLearningService) {}

  @Get('proposals')
  @ApiOperation({ summary: 'Listar propuestas de aprendizaje del tenant' })
  getProposals(@Request() req: any, @Query('status') status?: string) {
    return this.service.getProposals(req.user.tenant_id, status);
  }

  @Post('proposals/:id/review')
  @ApiOperation({ summary: 'Aprobar o rechazar una propuesta de aprendizaje' })
  reviewProposal(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { approve: boolean },
  ) {
    return this.service.reviewProposal(req.user.tenant_id, id, req.user.slot_id, body.approve);
  }
}
