import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { InstallationAgentService } from './installation-agent.service';

@ApiTags('Installation Agent')
@ApiBearerAuth()
@Controller('installation-agent')
export class InstallationAgentController {
  constructor(private readonly agent: InstallationAgentService) {}

  @Get('chat')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Iniciar sesión con el Agente Instalador' })
  greet() {
    return this.agent.greet();
  }

  @Post('chat')
  @Roles('superadmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Continuar conversación con el Agente Instalador' })
  chat(@Body() body: { session_id?: string; message: string }) {
    return this.agent.chat(body.session_id, body.message);
  }
}
