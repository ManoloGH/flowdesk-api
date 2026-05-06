import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { EncryptionModule } from './common/encryption/encryption.module';
import { AuditModule } from './common/audit/audit.module';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { TeamSlotsModule } from './modules/team-slots/team-slots.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { AgentMemoryModule } from './modules/agent-memory/agent-memory.module';
import { AgentConversationsModule } from './modules/agent-conversations/agent-conversations.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { PresenceModule } from './modules/presence/presence.module';
import { MessagesModule } from './modules/messages/messages.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { MapPropsModule } from './modules/map-props/map-props.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { PlatformModule } from './modules/platform/platform.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { BillingModule } from './modules/billing/billing.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BranchesModule } from './modules/branches/branches.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 200 }],
        // Redis si está disponible, en memoria si no (dev sin Redis)
        storage: process.env.REDIS_URL
          ? new ThrottlerStorageRedisService(new Redis(process.env.REDIS_URL))
          : undefined,
      }),
    }),
    EncryptionModule,
    AuditModule,
    PrismaModule,
    // Integraciones externas (global — disponible en todos los módulos)
    IntegrationsModule,
    // Core
    AuthModule,
    TenantsModule,
    DepartmentsModule,
    TeamSlotsModule,
    SchedulesModule,
    OnboardingModule,
    // Segundo Cerebro
    AgentMemoryModule,
    AgentConversationsModule,
    // Productividad personal
    TasksModule,
    // CRM
    ContactsModule,
    // Campus en tiempo real
    PresenceModule,
    MessagesModule,
    WebhooksModule,
    MapPropsModule,
    TelegramModule,
    PlatformModule,
    MeetingsModule,
    BillingModule,
    NotificationsModule,
    BranchesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
