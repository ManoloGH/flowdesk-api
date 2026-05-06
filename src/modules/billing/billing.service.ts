import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeLib = require('stripe');
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class BillingService {
  private stripe: any;
  private readonly logger = new Logger(BillingService.name);

  constructor(private prisma: PrismaService) {
    this.stripe = new StripeLib(process.env.STRIPE_SECRET_KEY ?? '', {
      apiVersion: '2024-12-18.acacia',
    });
  }

  async getStatus(tenantId: string) {
    return this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        plan: true,
        status: true,
        stripe_customer_id: true,
        stripe_subscription_id: true,
        stripe_sub_status: true,
        current_period_end: true,
        billing_email: true,
        name: true,
      },
    });
  }

  async createCheckoutSession(
    tenantId: string,
    plan: 'starter' | 'professional' | 'enterprise',
    ownerEmail: string,
  ) {
    const priceId = this.planToPrice(plan);
    if (!priceId) throw new Error(`No hay price de Stripe configurado para el plan: ${plan}`);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripe_customer_id: true, name: true },
    });

    let customerId = tenant?.stripe_customer_id;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: ownerEmail,
        name: tenant?.name,
        metadata: { tenant_id: tenantId },
      });
      customerId = customer.id;
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { stripe_customer_id: customerId, billing_email: ownerEmail },
      });
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${frontendUrl}/settings/billing?success=1`,
      cancel_url: `${frontendUrl}/settings/billing?canceled=1`,
      metadata: { tenant_id: tenantId, plan },
    });

    return { url: session.url };
  }

  async createPortalSession(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripe_customer_id: true },
    });
    if (!tenant?.stripe_customer_id) throw new Error('No hay suscripción de Stripe para este tenant');

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const session = await this.stripe.billingPortal.sessions.create({
      customer: tenant.stripe_customer_id,
      return_url: `${frontendUrl}/settings/billing`,
    });

    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    let event: any;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err: any) {
      this.logger.error(`Stripe webhook inválido: ${err.message}`);
      throw new Error('Firma de webhook inválida');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session: any = event.data.object;
        const tenantId: string | undefined = session.metadata?.tenant_id;
        const plan: string | undefined = session.metadata?.plan;
        if (tenantId && plan && session.subscription) {
          const sub: any = await this.stripe.subscriptions.retrieve(session.subscription as string);
          await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
              plan,
              stripe_subscription_id: sub.id,
              stripe_sub_status: sub.status,
              current_period_end: new Date(sub.current_period_end * 1000),
              status: 'active',
            },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub: any = event.data.object;
        const tenantId: string | null =
          sub.metadata?.tenant_id ||
          (await this.findTenantByCustomer(sub.customer));
        if (!tenantId) break;
        const priceId: string = sub.items.data[0]?.price.id;
        const plan = this.priceToPlan(priceId);
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: {
            ...(plan ? { plan } : {}),
            stripe_sub_status: sub.status,
            current_period_end: new Date(sub.current_period_end * 1000),
          },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub: any = event.data.object;
        const tenantId = await this.findTenantByCustomer(sub.customer);
        if (!tenantId) break;
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { stripe_sub_status: 'canceled', status: 'suspended' },
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice: any = event.data.object;
        const tenantId = await this.findTenantByCustomer(invoice.customer);
        if (!tenantId) break;
        await this.prisma.tenant.update({
          where: { id: tenantId },
          data: { stripe_sub_status: 'past_due' },
        });
        break;
      }
    }

    return { received: true };
  }

  async adminOverview() {
    const tenants = await this.prisma.tenant.findMany({
      where: { tenant_type: { not: 'PLATFORM' } },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        stripe_sub_status: true,
        current_period_end: true,
        billing_email: true,
        stripe_customer_id: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });

    const PLAN_PRICE: Record<string, number> = {
      starter: 49,
      professional: 149,
      enterprise: 399,
    };

    const active = tenants.filter(
      t => t.stripe_sub_status === 'active' || t.stripe_sub_status === 'trialing',
    );
    const mrr = active.reduce((sum, t) => sum + (PLAN_PRICE[t.plan] ?? 0), 0);
    const past_due = tenants.filter(t => t.stripe_sub_status === 'past_due').length;
    const plans_breakdown = { starter: 0, professional: 0, enterprise: 0 };
    for (const t of active) {
      if (t.plan in plans_breakdown) plans_breakdown[t.plan as keyof typeof plans_breakdown]++;
    }

    return { mrr, total: tenants.length, active: active.length, past_due, plans_breakdown, tenants };
  }

  private planToPrice(plan: string): string | null {
    const map: Record<string, string | undefined> = {
      starter: process.env.STRIPE_PRICE_STARTER,
      professional: process.env.STRIPE_PRICE_PROFESSIONAL,
      enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
    };
    return map[plan] ?? null;
  }

  private priceToPlan(priceId: string): string | null {
    const map: Record<string, string> = {};
    if (process.env.STRIPE_PRICE_STARTER) map[process.env.STRIPE_PRICE_STARTER] = 'starter';
    if (process.env.STRIPE_PRICE_PROFESSIONAL) map[process.env.STRIPE_PRICE_PROFESSIONAL] = 'professional';
    if (process.env.STRIPE_PRICE_ENTERPRISE) map[process.env.STRIPE_PRICE_ENTERPRISE] = 'enterprise';
    return map[priceId] ?? null;
  }

  private async findTenantByCustomer(customerId: string): Promise<string | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { stripe_customer_id: customerId },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }
}
