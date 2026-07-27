import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AiModule } from './ai/ai.module';
import { SearchModule } from './integrations/search/search.module';
import { WhatsAppChannelModule } from './modules/whatsapp-channel/whatsapp-channel.module';
import { PbxModule } from './modules/pbx/pbx.module';
import { InstallationAgentModule } from './modules/installation-agent/installation-agent.module';
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
import { GoalsModule } from './modules/goals/goals.module';
import { SpacesModule } from './modules/spaces/spaces.module';
import { CultureModule } from './modules/culture/culture.module';
import { VaultModule } from './modules/vault/vault.module';
import { BrainModule } from './modules/brain/brain.module';
import { SecretaryModule } from './modules/secretary/secretary.module';
import { SalesModule } from './modules/sales/sales.module';
import { AgentCalibrationModule } from './modules/agent-calibration/agent-calibration.module';
import { AgentEvolutionModule } from './modules/agent-evolution/agent-evolution.module';
import { AgentLearningModule } from './modules/agent-learning/agent-learning.module';
import { AgentPanelModule } from './modules/agent-panel/agent-panel.module';
import { WeeklyMeetingModule } from './modules/weekly-meeting/weekly-meeting.module';
import { WebProyectosModule } from './modules/web-proyectos/web-proyectos.module';
import { WebBuilderAgentModule } from './modules/web-builder-agent/web-builder-agent.module';
import { WidgetModule } from './modules/widget/widget.module';
import { PersonalAssistantModule } from './modules/personal-assistant/personal-assistant.module';
import { ImplementationsModule } from './modules/implementations/implementations.module';
import { MentoriaModule } from './modules/mentoria/mentoria.module';
import { ClienteDocsModule } from './modules/cliente-docs/cliente-docs.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { MicroDiagnosticoModule } from './modules/micro-diagnostico/micro-diagnostico.module';
import { SocModule } from './modules/soc/soc.module';
import { ProyectosSocModule } from './modules/proyectos-soc/proyectos-soc.module';
import { ErpAreasModule } from './modules/erp-areas/erp-areas.module';
import { EmailModule } from './modules/email/email.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 200 }],
        // Redis si estÃ¡ disponible, en memoria si no (dev sin Redis)
        storage: process.env.REDIS_URL
          ? new ThrottlerStorageRedisService(new Redis(process.env.REDIS_URL))
          : undefined,
      }),
    }),
    EncryptionModule,
    AuditModule,
    PrismaModule,
    // IA â€” proveedor unificado (Ollama, OpenRouter, Anthropic, OpenAI)
    AiModule,
    // BÃºsqueda web â€” Brave Search + Firecrawl con fallbacks gratuitos
    SearchModule,
    // Email — Resend (global)
    EmailModule,
    // Integraciones externas (global â€” disponible en todos los mÃ³dulos)
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
    // AUP Goals
    GoalsModule,
    // Spaces & Cameras
    SpacesModule,
    // Cultura operativa
    CultureModule,
    // Vault â€” credenciales cifradas
    VaultModule,
    // Empresa Brain â€” base de conocimiento vectorial
    BrainModule,
    // Secretary â€” Atlas Secretario Personal
    SecretaryModule,
    // WhatsApp Channel â€” routing inteligente (owner/empleado/cliente)
    WhatsAppChannelModule,
    // PBX Conmutador â€” Asterisk ARI + IA en llamadas
    PbxModule,
    // Agente Instalador â€” guÃ­a tÃ©cnica para el equipo de MentorIA
    InstallationAgentModule,
    // Sales â€” Pipeline + Agente Comercial
    SalesModule,
    // Agent Intelligence â€” CalibraciÃ³n, EvoluciÃ³n y Aprendizaje semanal
    AgentCalibrationModule,
    AgentEvolutionModule,
    AgentLearningModule,
    AgentPanelModule,
    WeeklyMeetingModule,
    // Web Builder â€” construcciÃ³n y seguimiento de webs de clientes
    WebProyectosModule,
    WebBuilderAgentModule,
    // Widget â€” agente conversacional embebido en landings
    WidgetModule,
    // Asistente Personal â€” empleado / gerente / director
    PersonalAssistantModule,
    // Implementaciones â€” protocolo de onboarding para el agente implementador de MentorIA
    ImplementationsModule,
    MentoriaModule,
    // Cliente Docs â€” propuestas, diagnÃ³sticos y cualquier documento enviado a clientes
    ClienteDocsModule,
    CommunicationsModule,
    MicroDiagnosticoModule,
    SocModule,
    ProyectosSocModule,
    ErpAreasModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}

