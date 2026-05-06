# flowdesk-api — NestJS Backend

## Stack
NestJS · Prisma v7 · PostgreSQL · WebSockets (Socket.io) · JWT Auth

## Módulos registrados en AppModule (17)

```
Core:          Auth, Tenants, Departments, TeamSlots, Schedules, Onboarding
Segundo Cerebro: AgentMemory, AgentConversations
Productividad: Tasks
CRM:           Contacts
Campus RT:     Presence, Messages, Webhooks, MapProps
Infra:         Prisma, Integrations (desde src/integrations/)
```

## Carpetas vacías en src/modules/ (stubs, NO en AppModule)
`audit` · `dashboard` · `files` · `notifications` · `rooms` · `time-logs` · `integrations`

## Reglas Prisma v7

```typescript
// schema.prisma
generator client {
  provider = "prisma-client-js"   // sin output personalizado → genera en node_modules/@prisma/client
}
datasource db {
  provider = "postgresql"
  // Sin url = env() — conexión vía PrismaPg adapter en PrismaService
}

// Importar así:
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// PrismaService: composición con getters, NO extends PrismaClient
```

## Integrations (src/integrations/)

```
chatwoot/   → ChatwootAdapter.processWebhook(payload, tenantId, gateway)
evolution/  → EvolutionAdapter.processWebhook(payload) → {type, from, content}
ghl/        → GhlAdapter.processWebhook(payload, tenantId)
google/     → Google Workspace
m365/       → Microsoft 365
```

## WebhooksService — flujo
1. Recibe payload con identifier (account_id / location_id / instance_name)
2. `resolveTenant(identifier)` → busca en tabla `Integration` por config JSON
3. Despacha al adapter correspondiente
4. Emite evento al campus via `messagesGateway.deliverToTenant()`

## Auth
- JWT: 15 min access / 7 días refresh
- Guards globales: JwtAuthGuard + RolesGuard (APP_GUARD)
- Lockout: 5 intentos / 15 min
- Decorador `@Public()` para excluir rutas del guard

## Comandos
```bash
npx prisma generate    # regenerar cliente (sin Docker)
npx prisma db push     # sincronizar schema (requiere Docker)
docker compose up -d   # PostgreSQL en localhost:5432
npm run start:dev      # watch mode en :3001
```

## Convenciones
- DTOs en `dto/` dentro de cada módulo, con class-validator
- Responses estándar: `{ data, message, statusCode }`
- Todos los modelos tienen `tenant_id` (multi-tenant)
- Fechas en UTC, campo `created_at` / `updated_at` en todos los modelos
