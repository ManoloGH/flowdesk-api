# FlowDesk — Arquitectura v2
_Spec cerrado: 2026-06-02_

---

## 1. Visión del sistema

FlowDesk es el sistema operativo para equipos híbridos humano-IA. Cada empresa que entra a FlowDesk termina con una infraestructura de agentes que opera su negocio — no como un template genérico, sino hiperpersonalizada.

**Filosofía de plataforma (5 pilares):**
1. Integración — todo conectado en un solo ecosistema
2. Visibilidad y control CEO — el dueño ve todo en una pantalla
3. Facilitar al empleado — 90% de tareas las cubre IA
4. Base de conocimiento empresarial — la empresa aprende y recuerda
5. Aliado emocional — Atlas como secretario personal, no solo herramienta

---

## 2. Modelo de negocio — MentorIA Systems

MentorIA Systems opera con DOS ramas, no con productos separados.

```
MentorIA Systems
├── Rama 1: Consultoría IA (proyectos)
│   ├── ENTRADA: Diagnóstico (revela ineficiencias que el cliente no ve)
│   └── IMPLEMENTACIÓN en 3 formas:
│       ├── a) Consultoría al equipo propio del cliente
│       ├── b) Agentes específicos (SaaS — resultado del diagnóstico)
│       └── c) Ecosistema completo (FlowDesk — resultado del diagnóstico)
│   → MentorIA le dice al cliente QUÉ hacer
│   → Comunicación de mkt: centrar en el diagnóstico, no en los SaaS
│
└── Rama 2: Partnerships (negocios socios)
    ├── MentorIA OPERA por ellos → % de participación
    ├── Selección: MentorIA elige con quién trabaja
    ├── FlowDesk → empresa partnership (SaaS #1)
    ├── Enseñanza → empresa partnership
    ├── Nodo → partnership inmobiliario (activo)
    ├── RSM → partnership inmobiliario (activo)
    └── Futuros SaaS → empresas partnership
    → MentorIA LO HACE por ellos
    → No se comunica masivamente ("parte escondida")
```

**Comunicación de marketing:** El diagnóstico es la puerta de entrada. Los SaaS (agentes, FlowDesk) son el RESULTADO del diagnóstico, no el producto principal. Las empresas que ya existen tienen procesos ineficientes — el diagnóstico les hace ver el problema y a partir de ahí se diseña la optimización.

---

## 3. Arquitectura de cuentas en FlowDesk

```
FlowDesk Platform (super admin técnico — capa independiente)
│   → Gestiona todos los tenants, configuración, monitoreo
│   → slug: "flowdesk" | plan: internal
│
├── Cuenta: FlowDesk (empresa SaaS)
│   ├── Sin empleados humanos
│   ├── Solo agentes IA (CEO, Crecimiento, Soporte)
│   ├── Meta empresarial: más usuarios, empresas IA-first
│   └── slug: "flowdesk-empresa" | account_type: SAAS_ACCOUNT
│
├── Cuenta: MentorIA Systems
│   ├── Rama Consultoría: clientes como proyectos con seguimiento
│   ├── Rama Partnerships: negocios socios monitoreados
│   ├── Agentes: Atlas (personal), Consultoría, Partnerships
│   └── slug: "mentoria" | account_type: SAAS_ACCOUNT
│
├── Cuenta: Nodo (partnership inmobiliario)
│   └── slug: "nodo" | account_type: PARTNERSHIP
│
├── Cuenta: RSM (partnership inmobiliario)
│   └── slug: "rsm" | account_type: PARTNERSHIP
│
└── Cuenta: Enseñanza MentorIA (partnership educativo)
    └── slug: "ensenanza" | account_type: PARTNERSHIP
```

**Regla fundamental:** MentorIA = cuenta de negocio igual que cualquier otra. NO tiene privilegios técnicos especiales. El Super Admin es la única capa con acceso técnico a todos los tenants.

---

## 4. Tipos de cuenta (onboarding)

| Tipo | Descripción | Quién llega |
|------|-------------|-------------|
| `CONSULTORIA_CLIENT` | Empresa que MentorIA está implementando | Resultado del diagnóstico |
| `PARTNERSHIP` | MentorIA opera el negocio (% participación) | Nodo, RSM, Enseñanza |
| `SAAS_ACCOUNT` | SaaS propio (FlowDesk, MentorIA) | Cuentas internas |
| `DIRECT` | Empresa que llega sola a FlowDesk | Fase futura |

**Onboarding Atlas según tipo:**
- `CONSULTORIA_CLIENT` → Configura según plan de implementación que MentorIA ya diseñó
- `PARTNERSHIP` → Configura profundo (MentorIA tiene acceso operativo)
- `DIRECT` → Atlas autónomo completo con los 5 capítulos

---

## 5. Atlas — Secretario Personal

Atlas NO es solo el onboarding agent. Es el **secretario personal permanente** de cada cuenta.

**Primera misión:** conocer la empresa (15 bloques de conocimiento).
**Misión continua:** asistente diario, morning brief, coordinación de operaciones.

### 15 Bloques de conocimiento de Atlas

| # | Bloque | Dónde se guarda |
|---|--------|-----------------|
| 1 | Identidad (nombre, misión, visión, tagline, colores) | campos tenant |
| 2 | Portafolio (productos/servicios, precios, propuesta de valor) | campus_config.portfolio |
| 3 | Equipo (humanos + agentes, roles, responsabilidades) | TeamSlot |
| 4 | Operaciones (procesos clave, workflows, herramientas) | campus_config.sops (JSON) |
| 5 | Metas/KSFs (objetivos anuales, trimestrales, métricas) | AUP models |
| 6 | Plataforma (integraciones activas, credenciales vault) | VaultEntry, IntegrationsModule |
| 7 | Reportes (KPIs habituales, frecuencia, destinatarios) | campus_config.reporting |
| 8 | Procesos/SOPs (detalle BPMN) | flowdesk-sops/ |
| 9 | Perfil Founder (ADN, estilo, obsesiones, anti-valores) | FounderProfile |
| 10 | Ritmos/Calendario (rituales, reuniones, ciclos) | CultureRitual, Google Calendar |
| 11 | Clientes activos (quiénes son, estado, próximos pasos) | SalesLayer (Grupo E) |
| 12 | Permisos (quién puede aprobar qué) | campus_config.permissions |
| 13 | Canales de comunicación (WhatsApp, email, Slack) | campus_config.channels |
| 14 | Contenido comercial (pitches, propuestas, mensajes clave) | campus_config.sales_content |
| 15 | Herramientas por empleado (qué usa cada quien) | secretary_config en TeamSlot |

**SOPs van en `campus_config.sops`** (JSON), NO nuevo modelo Prisma. El detalle/BPMN usa `flowdesk-sops/`.
**`secretary_config` en TeamSlot** = campo JSON para tools por empleado (Bloque 15).

---

## 6. Focus Mode

**Filosofía:** Claude analiza el estado de la empresa y genera el JSON del dashboard — no es estático.
**Endpoint:** `GET /tenants/mine/focus-brief`

### 5 zonas del Focus Mode

| Zona | Contenido |
|------|-----------|
| Hero card | Valor de impacto del día (generado por Claude) |
| Grid 4 métricas | KSFs más urgentes del momento |
| Stack de prioridades | Tasks críticos ordenados por impacto |
| Momentum | Trend de los últimos 7 días |
| Pulse operativo | Estado de agentes + integraciones |

---

## 7. Plan de implementación Fase 1

Grupos en orden de dependencia. Uno por sesión para no superar 1M tokens.

### Grupo A — Vault de credenciales
**Objetivo:** almacenar credenciales técnicas (WhatsApp, OAuth, Stripe, API keys) cifradas con AES-256-GCM.

**Schema:**
```prisma
model VaultEntry {
  id           String   @id @default(cuid())
  tenant_id    String
  tenant       Tenant   @relation(fields: [tenant_id], references: [id])
  key_name     String   // "EVOLUTION_API_KEY", "STRIPE_SECRET", etc.
  encrypted    String   // AES-256-GCM encrypted value
  iv           String   // initialization vector
  auth_tag     String
  category     String   // "whatsapp" | "email" | "billing" | "calendar" | "crm" | "other"
  description  String?
  created_at   DateTime @default(now())
  updated_at   DateTime @updatedAt

  access_logs  VaultAccessLog[]
  @@unique([tenant_id, key_name])
}

model VaultAccessLog {
  id         String   @id @default(cuid())
  entry_id   String
  entry      VaultEntry @relation(fields: [entry_id], references: [id])
  accessor   String   // "system" | slot_id
  action     String   // "read" | "write" | "delete"
  created_at DateTime @default(now())
}
```

**Archivos:**
- `src/modules/vault/vault.service.ts` — encrypt(), decrypt(), set(), get(), list(), delete()
- `src/modules/vault/vault.controller.ts` — endpoints REST
- `src/modules/vault/vault.module.ts`
- AppModule registration

**Variable requerida:** `VAULT_MASTER_KEY` (AES-256-GCM, 32 bytes: `openssl rand -base64 48`)

---

### Grupo B — Empresa Brain + pgvector
**Objetivo:** la empresa "aprende" — cada documento, conversación y decisión queda vectorizado para búsqueda semántica.

**Schema:**
```prisma
model EmpresaBrainDocument {
  id          String   @id @default(cuid())
  tenant_id   String
  tenant      Tenant   @relation(fields: [tenant_id], references: [id])
  source_type String   // "onboarding" | "sop" | "conversation" | "document" | "decision"
  source_id   String?  // ID del objeto origen (si aplica)
  title       String
  content     String
  embedding   Unsupported("vector(1536)")?
  metadata    Json     @default("{}")
  created_at  DateTime @default(now())
}
```

**Archivos:**
- `src/modules/brain/embedding.service.ts` — OpenAI text-embedding-3-small, upsert, search
- `src/modules/brain/brain.service.ts` — addDocument(), search(), summarize()
- `src/modules/brain/brain.module.ts`

**Variable requerida:** `OPENAI_API_KEY`
**Migración:** pgvector extension + `ALTER TABLE "EmpresaBrainDocument" ADD COLUMN embedding vector(1536)`

---

### Grupo C — Secretary Agent + WhatsApp
**Objetivo:** Atlas como secretario personal vía WhatsApp. Morning brief, aprobaciones, delegación.

**Schema adicional:**
```prisma
model SecretaryConfig {
  id             String   @id @default(cuid())
  tenant_id      String   @unique
  tenant         Tenant   @relation(fields: [tenant_id], references: [id])
  owner_phone    String   // número WhatsApp del owner
  morning_brief_time String @default("08:00")
  enabled        Boolean  @default(true)
  created_at     DateTime @default(now())
}

model PendingApproval {
  id          String   @id @default(cuid())
  tenant_id   String
  tenant      Tenant   @relation(fields: [tenant_id], references: [id])
  requested_by String  // slot_id
  description String
  context     Json
  status      String   @default("pending") // "pending" | "approved" | "rejected"
  decided_by  String?
  decided_at  DateTime?
  created_at  DateTime @default(now())
}

model DelegationHistory {
  id          String   @id @default(cuid())
  tenant_id   String
  from_slot   String
  to_slot     String
  task        String
  result      String?
  created_at  DateTime @default(now())
}

model WorkReport {
  id          String   @id @default(cuid())
  tenant_id   String
  slot_id     String
  period      String   // "daily" | "weekly"
  content     Json
  created_at  DateTime @default(now())
}
```

**Archivos:**
- `src/modules/secretary/secretary.service.ts` — config, approvals, delegation, morning brief
- `src/modules/secretary/whatsapp.service.ts` — Evolution API send/receive
- `src/modules/secretary/secretary-agent.service.ts` — Claude conversation loop
- `src/modules/secretary/secretary.controller.ts` + webhook Evolution
- `src/modules/secretary/secretary.module.ts`

**Variables requeridas:** `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`

---

### Grupo D — Onboarding Atlas 5 capítulos
**Objetivo:** Atlas guía a la empresa desde cero hasta operativa. Incluye Capítulo 0 de tipo de cuenta y config técnica.

**Capítulos:**
- Cap 0: Tipo de cuenta + configuración técnica (WhatsApp, email, billing, Chatwoot, dominio, CRM)
- Cap 1-2: Empresa + fundador (WhatsApp)
- Cap 3-4: Identidad + operaciones (Web dual-panel)
- Cap 5: Lanzamiento (Web + WhatsApp)

**Archivos:**
- `src/modules/onboarding/document-parser.service.ts` — Claude extrae datos estructurados de PDF/Word
- `src/modules/onboarding/onboarding-agent.service.ts` — reescribir Atlas con 5 capítulos + Cap 0

**Pendiente actual:** `POST /onboarding/upload-doc` — el frontend lo llama pero el backend no existe.

---

### Grupo E — SalesLayer
**Objetivo:** pipeline de ventas, deals, seguimiento de clientes activos.

**Schema:**
```prisma
model SalesDeal {
  id          String   @id @default(cuid())
  tenant_id   String
  tenant      Tenant   @relation(fields: [tenant_id], references: [id])
  contact_id  String?
  title       String
  stage       String   // "lead" | "qualified" | "proposal" | "negotiation" | "won" | "lost"
  value       Float?
  currency    String   @default("MXN")
  notes       String?
  lost_reason String?
  closed_at   DateTime?
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
}
```

**Archivos:**
- `src/modules/sales/sales.service.ts`
- `src/modules/sales/sales.module.ts`
- Agente Comercial integrado al CEO Agent

---

### Grupo F — Billing Agent
**Objetivo:** facturación automática con Stripe Connect y CFDI vía Facturapi.

**Schema:**
```prisma
model BillingConfig {
  id               String   @id @default(cuid())
  tenant_id        String   @unique
  stripe_account_id String?
  facturapi_org_id  String?
  rfc              String?
  fiscal_regime    String?
  created_at       DateTime @default(now())
}
```

**Variables requeridas:** `STRIPE_SECRET_KEY`, `FACTURAPI_API_KEY`

---

### Grupo G — Focus Mode ✅ (HECHO)

Frontend ya implementado.

---

### Grupo H — Seed MentorIA v2
**Estado:** `setup-tenants.ts` ya existe con arquitectura v2. Necesita ejecutarse en Railway.
**Seed de MentorIA profundo:** `mentoria.ts` tiene Culture Engine completo pero con modelo antiguo. Actualizar instrucciones de agentes para reflejar 2 ramas operativas.

**Ejecutar en orden:**
```bash
DATABASE_URL=<railway_url> npx ts-node prisma/seeds/setup-tenants.ts
DATABASE_URL=<railway_url> npx ts-node prisma/seeds/mentoria.ts
```

---

### Grupo I — Deploy Railway + verificación end-to-end
**Estado:** API + Vercel activos. Faltan módulos nuevos (A-H).
**Pendientes:**
- Agregar `FRONTEND_URL=https://flowdesk.mx` en Railway Variables
- Agregar todas las variables nuevas (VAULT_MASTER_KEY, OPENAI_API_KEY, EVOLUTION_*)
- Ejecutar seeds en Railway
- Verificar que los módulos nuevos están registrados en AppModule

---

## 8. Reglas de sesión (para no superar 1M tokens)

1. **Un grupo por sesión** (A, B, C...) — nunca dos juntos
2. **`/compact` después de cada módulo** completado
3. **Subagentes** para Tasks independientes dentro de un grupo
4. **No leer schema.prisma completo** — solo las líneas del modelo que se necesita

---

## 9. Checklist pre-deploy por módulo

```
□ Migration ejecutada y registrada
□ Módulo registrado en AppModule
□ Variables de entorno en Railway
□ Tests de humo (endpoint responde 200)
□ Seed actualizado si aplica
□ Verificar en flowdesk.mx
```
