import { Controller, Get, Post, Body, Req, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, TenantId } from '../../common/decorators/tenant.decorator';
import { BillingService } from './billing.service';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Estado de facturación del tenant actual' })
  getStatus(@TenantId() tenantId: string) {
    return this.billing.getStatus(tenantId);
  }

  @Post('checkout')
  @Roles('owner')
  @ApiOperation({ summary: '[Owner] Crear sesión de Stripe Checkout para suscribirse o cambiar de plan' })
  createCheckout(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Body() body: { plan: 'starter' | 'professional' | 'enterprise' },
  ) {
    return this.billing.createCheckoutSession(tenantId, body.plan, user.email);
  }

  @Post('portal')
  @Roles('owner')
  @ApiOperation({ summary: '[Owner] Abrir portal de Stripe para gestionar pago, cancelar, etc.' })
  createPortal(@TenantId() tenantId: string) {
    return this.billing.createPortalSession(tenantId);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook de Stripe — verificado por firma HMAC' })
  handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    // req.body es Buffer (express.raw aplicado en main.ts para esta ruta)
    return this.billing.handleWebhook(req.body as Buffer, signature);
  }

  @Get('admin/overview')
  @Roles('superadmin')
  @ApiOperation({ summary: '[Super-admin] MRR, planes activos, clientes con pago vencido' })
  adminOverview() {
    return this.billing.adminOverview();
  }
}
