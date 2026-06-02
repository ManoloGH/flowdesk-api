import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, Request,
} from '@nestjs/common';
import { VaultService, VaultSetDto } from './vault.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('vault')
@UseGuards(JwtAuthGuard)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Post()
  @Roles('owner', 'admin')
  set(@Request() req: any, @Body() dto: VaultSetDto) {
    return this.vault.set(req.user.tenant_id, dto, req.user.slot_id);
  }

  @Get()
  @Roles('owner', 'admin')
  list(@Request() req: any) {
    return this.vault.list(req.user.tenant_id);
  }

  @Get(':keyName/value')
  @Roles('owner', 'admin')
  get(@Request() req: any, @Param('keyName') keyName: string) {
    return this.vault.get(req.user.tenant_id, keyName, req.user.slot_id).then(v => ({ value: v }));
  }

  @Delete(':keyName')
  @Roles('owner', 'admin')
  remove(@Request() req: any, @Param('keyName') keyName: string) {
    return this.vault.delete(req.user.tenant_id, keyName, req.user.slot_id);
  }
}
