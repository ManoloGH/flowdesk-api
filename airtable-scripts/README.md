# Automatizaciones AIMA ERP

## Scripts de Airtable (pegar en Run Script)

| Archivo | Automation | Trigger |
|---------|-----------|---------|
| `01-pago-cobrado-cliente-proyecto.js` | Pago cobrado → Cliente + Proyecto | When record matches: Pagos.Estado = "Cobrada" |
| `02-generacion-pagos-recurrentes.js` | Retainers mensuales | Scheduled: día 1 de cada mes, 09:00 |
| `03-daily-briefing-seguimientos.js` | Daily briefing | Scheduled: todos los días, 09:00 |
| `04-lead-estancado-pipeline.js` | Lead estancado | Scheduled: lunes, 09:00 |

---

## Flujo completo: Pago Cobrado → FlowDesk Desk

```
Airtable: Pago.Estado = "Cobrada"
  └→ Script 01: crea Proyecto, marca Propuesta = "Ganada"
       └→ fetch() al webhook n8n (si N8N_WEBHOOK_URL configurado)
            └→ n8n: valida datos
                 └→ FlowDesk API: POST /webhooks/provision-tenant
                      └→ crea Tenant + Owner + Atlas CEO Agent
                           └→ n8n: PATCH Airtable Propuesta
                                └→ escribe Tenant ID FlowDesk + URL Desk
```

---

## Variables de entrada del script 01

En la automation de Airtable, en el bloque "Run script" → "Input variables":

| Nombre | Tipo | Valor |
|--------|------|-------|
| `pagoId` | Airtable record ID | `{record ID del trigger}` |
| `N8N_WEBHOOK_URL` | Text | `https://tu-n8n.com/webhook/propuesta-ganada` |
| `FLOWDESK_SECRET` | Text | (el mismo valor de `FLOWDESK_WEBHOOK_SECRET` en el .env de la API) |

Si no configuras `N8N_WEBHOOK_URL`, el script funciona igual pero no provisiona el desk automáticamente.

---

## Variables de entorno requeridas en n8n

En n8n → Settings → Environment Variables:

| Variable | Descripción |
|----------|-------------|
| `FLOWDESK_API_URL` | URL base de la API (ej. `https://api.flowdesk.io`) |
| `FLOWDESK_WEBHOOK_SECRET` | Secreto compartido (el mismo del .env de la API) |
| `AIRTABLE_API_KEY` | Personal Access Token de Airtable |
| `AIRTABLE_BASE_ID` | ID de la base (ej. `appXXXXXXXX`) |
| `AIRTABLE_PROPUESTAS_TABLE_ID` | ID de la tabla Propuestas (ej. `tblXXXXXX`) |

---

## Variables de entorno requeridas en FlowDesk API (.env)

```
FLOWDESK_WEBHOOK_SECRET=tu_secreto_aleatorio_aqui
DEEPGRAM_API_KEY=tu_deepgram_key
```

---

## Campos que se agregan a la tabla Propuestas en Airtable

Agregar estos campos manualmente en Airtable antes de activar el workflow:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `Tenant ID FlowDesk` | Single line text | ID interno del tenant creado |
| `URL Desk` | URL | Link al desk del cliente |
| `Estado FlowDesk` | Single select | Activo / Inactivo |

---

## Importar el workflow de n8n

1. Abrir n8n → Workflows → Import
2. Seleccionar `n8n-workflows/propuesta-ganada-provision-tenant.json`
3. Configurar las env vars arriba
4. Activar el workflow
5. Copiar la URL del webhook (ej. `https://tu-n8n.com/webhook/propuesta-ganada`)
6. Pegar esa URL como variable `N8N_WEBHOOK_URL` en el script 01 de Airtable
