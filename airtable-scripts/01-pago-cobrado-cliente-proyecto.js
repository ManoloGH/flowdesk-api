// ============================================================================
// Automation: Pago cobrado → Cliente activo + Proyecto creado + FlowDesk
//
// Trigger:  When record matches conditions
// Tabla:    Pagos
// Condicion: Estado es "Cobrada"
// Action:   Run script
//
// Input variables:
//   pagoId  →  Airtable record ID  (del trigger)
//   N8N_WEBHOOK_URL  →  URL del webhook n8n (ej. https://n8n.tudominio.com/webhook/propuesta-ganada)
//   FLOWDESK_SECRET  →  secreto compartido con FlowDesk
//
// ============================================================================

const { pagoId, N8N_WEBHOOK_URL, FLOWDESK_SECRET } = input.config();

const pagosTbl      = base.getTable("Pagos");
const propuestasTbl = base.getTable("Propuestas");
const proyectosTbl  = base.getTable("Proyectos");
const crmTbl        = base.getTable("CRM");

const today = new Date().toISOString().split("T")[0];

const tipoMap = {
  "Auditoria":       "Auditoria IA",
  "AIMA Retainer":   "AIMA Setup",
  "Implementacion":  "Implementacion F1",
  "Custom":          "Consultoria puntual",
};

// ── 1. Leer el Pago ──────────────────────────────────────────────────────────

const pago = await pagosTbl.selectRecordAsync(pagoId, {
  fields: ["N factura", "Monto", "Estado", "Propuesta", "Proyecto", "Contacto", "Concepto"],
});

if (!pago) { console.log("Pago no encontrado: " + pagoId); return; }
if (pago.getCellValueAsString("Estado") !== "Cobrada") { console.log("Pago no Cobrada, saltando"); return; }

const propuestaLinks       = pago.getCellValue("Propuesta");
const proyectoLinks        = pago.getCellValue("Proyecto");
const contactoLinksFromPago = pago.getCellValue("Contacto");

console.log(`Procesando Pago ${pago.getCellValueAsString("N factura")} (${pagoId})`);

let proyectoId = proyectoLinks && proyectoLinks.length > 0 ? proyectoLinks[0].id : null;
let propuestaParaFlowDesk  = null;
let contactoParaFlowDesk   = null;

// ── CASO A: Primer pago de Propuesta → crear Proyecto ────────────────────────

if (propuestaLinks && propuestaLinks.length > 0 && !proyectoId) {
  console.log("Primer pago de una Propuesta: creando Proyecto nuevo");

  const propuesta = await propuestasTbl.selectRecordAsync(propuestaLinks[0].id, {
    fields: [
      "Codigo propuesta", "Tipo oferta", "Servicios",
      "Setup propuesto", "Retainer propuesto", "% Comision propuesta",
      "Contacto", "Responsable comercial", "Estado",
    ],
  });

  if (!propuesta) { console.log("ERROR: Propuesta no encontrada"); return; }

  const tipoOferta   = propuesta.getCellValueAsString("Tipo oferta") || "Custom";
  const proyectoTipo = tipoMap[tipoOferta] || "Consultoria puntual";
  const contactoLinks = propuesta.getCellValue("Contacto") || contactoLinksFromPago || [];

  if (!contactoLinks || contactoLinks.length === 0) {
    console.log("ERROR: Sin Contacto en Propuesta ni Pago");
    return;
  }

  const codigoPropuesta = propuesta.getCellValueAsString("Codigo propuesta") || "SIN-CODIGO";
  const codigoProyecto  = codigoPropuesta.replace(/^(\d{4})-P-/, "$1-PROJ-") || `${today}-PROJ`;

  const newProyectoId = await proyectosTbl.createRecordAsync({
    "Codigo proyecto":    codigoProyecto,
    "Contacto":           contactoLinks,
    "Tipo":               { name: proyectoTipo },
    "Servicios":          propuesta.getCellValue("Servicios") || [],
    "Estado":             { name: "Firmado" },
    "Modelo pricing":     { name: "Setup+Retainer fijo" },
    "Setup fee":          propuesta.getCellValue("Setup propuesto") || 0,
    "Recurrencia mensual":propuesta.getCellValue("Retainer propuesto") || 0,
    "% Comision":         propuesta.getCellValue("% Comision propuesta") || 0,
    "Fecha firma contrato": today,
    "Fecha kickoff":      today,
    "Propuesta origen":   [{ id: propuesta.id }],
    "Responsable proyecto": (propuesta.getCellValue("Responsable comercial") || [])[0]
      ? [{ id: propuesta.getCellValue("Responsable comercial")[0].id }]
      : undefined,
  });

  console.log(`  Creado Proyecto ${codigoProyecto} (${newProyectoId})`);
  proyectoId = newProyectoId;

  await pagosTbl.updateRecordAsync(pagoId, { "Proyecto": [{ id: newProyectoId }] });
  console.log("  Pago linkado al nuevo Proyecto");

  if (propuesta.getCellValueAsString("Estado") !== "Ganada") {
    await propuestasTbl.updateRecordAsync(propuesta.id, {
      "Estado":       { name: "Ganada" },
      "Fecha cierre": today,
    });
    console.log("  Propuesta marcada como Ganada");
  }

  // Guardar referencias para notificar FlowDesk
  propuestaParaFlowDesk = { id: propuesta.id, codigo: codigoProyecto, contactoLinks };
  contactoParaFlowDesk  = contactoLinks[0];
}

// ── CASO B: Pago con Proyecto existente → actualizar estados ─────────────────

if (proyectoId) {
  const proyecto = await proyectosTbl.selectRecordAsync(proyectoId, {
    fields: ["Codigo proyecto", "Estado", "Contacto"],
  });

  if (proyecto && proyecto.getCellValueAsString("Estado") === "Borrador") {
    await proyectosTbl.updateRecordAsync(proyectoId, {
      "Estado":             { name: "Firmado" },
      "Fecha firma contrato": today,
    });
    console.log("  Proyecto Borrador → Firmado");
  }

  const contactoLinks = proyecto
    ? proyecto.getCellValue("Contacto")
    : contactoLinksFromPago;

  if (contactoLinks && contactoLinks.length > 0) {
    const contactoId = contactoLinks[0].id;
    const contacto = await crmTbl.selectRecordAsync(contactoId, {
      fields: ["Nombre contacto", "Estado cuenta"],
    });
    if (contacto && contacto.getCellValueAsString("Estado cuenta") === "Prospecto") {
      await crmTbl.updateRecordAsync(contactoId, {
        "Estado cuenta": { name: "Cliente activo" },
      });
      console.log(`  Contacto ${contacto.getCellValueAsString("Nombre contacto")} → Cliente activo`);
    }
  }
}

// ── Notificar FlowDesk via n8n (solo en CASO A — nuevo Proyecto) ─────────────
// El webhook n8n recibirá los datos, provisionará el desk y actualizará Airtable.
// Si N8N_WEBHOOK_URL no está configurado, se omite sin error.

if (propuestaParaFlowDesk && N8N_WEBHOOK_URL) {
  try {
    // Leer email/nombre del contacto desde CRM
    let ownerEmail = "";
    let ownerName  = "";
    if (contactoParaFlowDesk) {
      const contacto = await crmTbl.selectRecordAsync(contactoParaFlowDesk.id, {
        fields: ["Nombre contacto", "Email", "Empresa"],
      });
      if (contacto) {
        ownerEmail = contacto.getCellValueAsString("Email") || "";
        ownerName  = contacto.getCellValueAsString("Nombre contacto") || "";
      }
    }

    const payload = {
      airtable_record_id: propuestaParaFlowDesk.id,
      company_name:       contactoParaFlowDesk
        ? (await crmTbl.selectRecordAsync(contactoParaFlowDesk.id, { fields: ["Empresa"] })).getCellValueAsString("Empresa") || ownerName
        : ownerName,
      owner_email:        ownerEmail,
      owner_name:         ownerName,
      external_ref:       propuestaParaFlowDesk.codigo,
      tenant_type:        "NETWORK",
    };

    const res = await fetch(N8N_WEBHOOK_URL, {
      method:  "POST",
      headers: {
        "Content-Type":       "application/json",
        "x-flowdesk-secret":  FLOWDESK_SECRET || "",
      },
      body: JSON.stringify(payload),
    });

    console.log(`  FlowDesk webhook: ${res.status}`);
  } catch (e) {
    console.log("  WARNING FlowDesk webhook: " + e.message);
    // No bloqueamos la automatización si falla la notificación
  }
}

console.log("OK: flujo completado");
