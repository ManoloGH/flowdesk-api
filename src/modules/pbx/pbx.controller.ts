import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PbxService } from './pbx.service';
import { TenantId } from '../../common/decorators/tenant.decorator';

@UseGuards(JwtAuthGuard)
@Controller('pbx')
export class PbxController {
  constructor(private readonly pbx: PbxService) {}

  // Listar extensiones SIP del tenant
  @Get('extensions')
  getExtensions(@TenantId() tenantId: string) {
    return this.pbx.getExtensions(tenantId);
  }

  // Asignar extensión a un empleado
  @Put('extensions/:slotId')
  assignExtension(
    @TenantId() tenantId: string,
    @Param('slotId') slotId: string,
    @Body() body: { extension: string; sip_password: string },
  ) {
    return this.pbx.assignExtension(tenantId, slotId, body.extension, body.sip_password);
  }

  // Historial de llamadas
  @Get('calls')
  getCallHistory(@TenantId() tenantId: string) {
    return this.pbx.getCallHistory(tenantId);
  }

  // Estado de conexión Asterisk
  @Get('status')
  getStatus() {
    return this.pbx.getStatus();
  }
}
