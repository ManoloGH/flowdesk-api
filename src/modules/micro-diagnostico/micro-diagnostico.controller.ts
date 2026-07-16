import { Controller, Get, Param, Req } from '@nestjs/common';
import { MicroDiagnosticoService } from './micro-diagnostico.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('micro-diagnostico')
export class MicroDiagnosticoController {
  constructor(private readonly svc: MicroDiagnosticoService) {}

  @Public()
  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.svc.findByToken(token);
  }

  @Get()
  listForTenant(@Req() req: any) {
    return this.svc.listByTenant(req.user.tenant_id);
  }
}
