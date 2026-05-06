// ============================================================================
// Automation: Lead estancado en pipeline
//
// Trigger:  At a scheduled time — Every week, Monday at 09:00
// Action 1: Run script  (este archivo)
// Action 2: Send email  — Only if [count] > 0
//   To:      tu email
//   Subject: 🧊 Leads estancados en pipeline ([count])
//   Body:    variable `summary`
//
// Config: cambia DIAS_UMBRAL para ajustar el umbral de días sin movimiento.
// ============================================================================

const DIAS_UMBRAL = 7;

const crmTbl = base.getTable("CRM");

const now        = new Date();
const todayIso   = now.toISOString().split("T")[0];
const todayStr   = now.toLocaleDateString("es-ES", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

const ESTADOS_ACTIVOS = ["Nuevo", "Contactado", "Cualificado", "Reunion agendada", "Propuesta enviada"];

// 1. Cargar Prospectos activos
const crmResult = await crmTbl.selectRecordsAsync({
  fields: ["Nombre contacto", "Empresa", "Estado cuenta", "Estado pipeline",
           "Ultimo cambio pipeline", "Fecha aviso estancado", "Propietario"],
});

const prospectosActivos = crmResult.records.filter((r) => {
  return r.getCellValueAsString("Estado cuenta") === "Prospecto"
    && ESTADOS_ACTIVOS.includes(r.getCellValueAsString("Estado pipeline"));
});

console.log(`Prospectos activos: ${prospectosActivos.length}`);

// 2. Filtrar estancados no avisados en este ciclo
const aReportar = [];
for (const r of prospectosActivos) {
  const ultimoCambio = r.getCellValue("Ultimo cambio pipeline");
  if (!ultimoCambio) continue;

  const ultimoCambioDate = new Date(ultimoCambio);
  const diasSinMoverse = Math.floor((now - ultimoCambioDate) / (24 * 60 * 60 * 1000));
  if (diasSinMoverse < DIAS_UMBRAL) continue;

  const fechaAviso = r.getCellValue("Fecha aviso estancado");
  if (fechaAviso && new Date(fechaAviso) >= ultimoCambioDate) continue; // ya avisado este ciclo

  aReportar.push({ record: r, diasSinMoverse, estadoPipeline: r.getCellValueAsString("Estado pipeline") });
}

console.log(`Leads a reportar: ${aReportar.length}`);

if (aReportar.length === 0) {
  output.set("count", 0);
  output.set("summary", "");
  return;
}

// 3. Ordenar por más estancados primero + agrupar por estado
aReportar.sort((a, b) => b.diasSinMoverse - a.diasSinMoverse);

const porEstado = {};
for (const e of aReportar) {
  if (!porEstado[e.estadoPipeline]) porEstado[e.estadoPipeline] = [];
  porEstado[e.estadoPipeline].push(e);
}

// 4. Construir HTML
const formatItem = (e) => {
  const r         = e.record;
  const nombre    = r.getCellValueAsString("Nombre contacto") || "Sin nombre";
  const empresa   = r.getCellValueAsString("Empresa") || "—";
  const propietario = (r.getCellValue("Propietario") || [])[0]?.name || "—";
  return `<li><strong>${nombre}</strong> (${empresa}) — <em>${e.diasSinMoverse} días</em> · owner: ${propietario}</li>`;
};

let html = `<h2>🧊 Leads recién estancados — ${todayStr}</h2>`;
html += `<p><strong>${aReportar.length}</strong> leads llevan ≥${DIAS_UMBRAL} días sin moverse.</p>`;

for (const estado of ESTADOS_ACTIVOS) {
  if (!porEstado[estado]) continue;
  html += `<h3>${estado} (${porEstado[estado].length})</h3><ul>`;
  for (const e of porEstado[estado]) html += formatItem(e);
  html += `</ul>`;
}

html += `<hr><p><small>Umbral: ${DIAS_UMBRAL} días · ERP AIMA</small></p>`;

// 5. Marcar cada lead con Fecha aviso estancado = hoy (idempotencia)
const updates = aReportar.map((e) => ({ id: e.record.id, fields: { "Fecha aviso estancado": todayIso } }));
const batchSize = 50;
for (let i = 0; i < updates.length; i += batchSize) {
  await crmTbl.updateRecordsAsync(updates.slice(i, i + batchSize));
}
console.log(`Marcados ${updates.length} leads con Fecha aviso estancado`);

output.set("count", aReportar.length);
output.set("summary", html);
console.log("Resumen generado, pasando a Send email.");
