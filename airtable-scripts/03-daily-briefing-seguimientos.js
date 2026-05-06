// ============================================================================
// Automation: Daily briefing de seguimientos
//
// Trigger:  At a scheduled time — Every day at 09:00
// Action 1: Run script  (este archivo)
// Action 2: Send email  — Only if [count] > 0
//   To:      tu email
//   Subject: Seguimientos pendientes del [fecha] ([count])
//   Body:    variable `summary` del step anterior
//
// Output variables que expone el script:
//   count           → número de seguimientos pendientes (usar en condición del email)
//   summary         → HTML del email
//   atrasadasCount  → cuántas están atrasadas
//   hoyCount        → cuántas son para hoy
// ============================================================================

const interTbl = base.getTable("Interacciones");

const today = new Date();
today.setHours(23, 59, 59, 999);

const todayDateStr = new Date().toLocaleDateString("es-ES", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
});

// 1. Buscar interacciones con siguiente acción pendiente
const interResult = await interTbl.selectRecordsAsync({
  fields: ["Titulo", "Tipo", "Contacto", "Fecha siguiente accion", "Siguiente accion", "Responsable"],
});

const pendientes = interResult.records.filter((r) => {
  const fsa       = r.getCellValue("Fecha siguiente accion");
  const siguiente = r.getCellValueAsString("Siguiente accion");
  return fsa && siguiente && new Date(fsa) <= today;
});

console.log(`Seguimientos pendientes: ${pendientes.length}`);

if (pendientes.length === 0) {
  output.set("count", 0);
  output.set("summary", "");
  output.set("atrasadasCount", 0);
  output.set("hoyCount", 0);
  return;
}

// 2. Separar atrasadas vs hoy
const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
const atrasadas = [], hoy = [];

for (const r of pendientes) {
  new Date(r.getCellValue("Fecha siguiente accion")) < startOfToday
    ? atrasadas.push(r)
    : hoy.push(r);
}

atrasadas.sort((a, b) =>
  new Date(a.getCellValue("Fecha siguiente accion")) - new Date(b.getCellValue("Fecha siguiente accion"))
);

// 3. Construir HTML
const formatItem = (r) => {
  const contacto = (r.getCellValue("Contacto") || [])[0]?.name || "Sin contacto";
  const tipo     = r.getCellValueAsString("Tipo") || "-";
  const siguiente = r.getCellValueAsString("Siguiente accion") || "-";
  const fechaStr  = new Date(r.getCellValue("Fecha siguiente accion")).toLocaleDateString("es-ES");
  return `<li><strong>${contacto}</strong> (${tipo}) — ${siguiente} <em>[${fechaStr}]</em></li>`;
};

let html = `<h2>Seguimientos pendientes — ${todayDateStr}</h2>`;
html += `<p>Tienes <strong>${pendientes.length}</strong> seguimientos pendientes.</p>`;

if (atrasadas.length > 0) {
  html += `<h3>🚨 Atrasadas (${atrasadas.length})</h3><ul>`;
  for (const r of atrasadas) html += formatItem(r);
  html += `</ul>`;
}

if (hoy.length > 0) {
  html += `<h3>📅 Para hoy (${hoy.length})</h3><ul>`;
  for (const r of hoy) html += formatItem(r);
  html += `</ul>`;
}

html += `<hr><p><small>Enviado automáticamente desde el ERP AIMA · Airtable Automations</small></p>`;

output.set("count", pendientes.length);
output.set("summary", html);
output.set("atrasadasCount", atrasadas.length);
output.set("hoyCount", hoy.length);

console.log("Resumen generado, pasando a Send email.");
