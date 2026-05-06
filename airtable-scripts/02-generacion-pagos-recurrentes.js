// ============================================================================
// Automation: Generación Pagos Recurrentes (Retainers mensuales)
//
// Trigger:  At a scheduled time
// Frecuencia: Every month, day 1, at 09:00
// Action:   Run script
// Input variables: NINGUNA
//
// Qué hace:
//   Cada día 1 del mes a las 9am, encuentra todos los Proyectos con
//   Estado="Recurrencia activa" y Recurrencia mensual > 0, y crea un Pago
//   pendiente por cada uno. Idempotente: no duplica si ya existe para el mes.
// ============================================================================

const proyectosTbl = base.getTable("Proyectos");
const pagosTbl     = base.getTable("Pagos");

const today     = new Date();
const yyyy      = today.getFullYear();
const monthNames = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];
const monthName   = monthNames[today.getMonth()];
const detalleKey  = `Retainer ${monthName} ${yyyy}`;
const fechaEmision = today.toISOString().split("T")[0];

// 1. Retainers activos con recurrencia > 0
const proyectosResult = await proyectosTbl.selectRecordsAsync({
  fields: ["Codigo proyecto", "Estado", "Recurrencia mensual", "Contacto"],
});

const retainersActivos = proyectosResult.records.filter((r) => {
  return r.getCellValueAsString("Estado") === "Recurrencia activa"
    && (r.getCellValue("Recurrencia mensual") || 0) > 0;
});

console.log(`Retainers activos: ${retainersActivos.length}`);
if (retainersActivos.length === 0) { console.log("Nada que hacer."); return; }

// 2. Verificar duplicados + calcular siguiente número secuencial
const pagosExistentes = await pagosTbl.selectRecordsAsync({
  fields: ["N factura", "Proyecto", "Concepto", "Detalle concepto"],
});

const yaConPago = new Set();
let maxSeq = 0;
const prefijoAno = `${yyyy}-`;

for (const p of pagosExistentes.records) {
  if (p.getCellValueAsString("Concepto") === "Retainer"
      && p.getCellValueAsString("Detalle concepto") === detalleKey) {
    const proy = p.getCellValue("Proyecto") || [];
    if (proy.length > 0) yaConPago.add(proy[0].id);
  }
  const nf = p.getCellValueAsString("N factura") || "";
  if (nf.startsWith(prefijoAno)) {
    const num = parseInt(nf.substring(prefijoAno.length), 10);
    if (!isNaN(num) && num > maxSeq) maxSeq = num;
  }
}

// 3. Construir lista de Pagos a crear
const pagosACrear = [];
let seqActual = maxSeq;

for (const proy of retainersActivos) {
  if (yaConPago.has(proy.id)) {
    console.log(`  Skip: ${proy.getCellValueAsString("Codigo proyecto")} ya tiene Pago para ${monthName}`);
    continue;
  }
  const contactoLinks = proy.getCellValue("Contacto") || [];
  if (contactoLinks.length === 0) {
    console.log(`  Skip: ${proy.getCellValueAsString("Codigo proyecto")} sin Contacto`);
    continue;
  }
  seqActual += 1;
  pagosACrear.push({
    fields: {
      "N factura":        `${yyyy}-${String(seqActual).padStart(4, "0")}`,
      "Contacto":         [{ id: contactoLinks[0].id }],
      "Proyecto":         [{ id: proy.id }],
      "Concepto":         { name: "Retainer" },
      "Detalle concepto": detalleKey,
      "Monto":            proy.getCellValue("Recurrencia mensual"),
      "Fecha emision":    fechaEmision,
      "Estado":           { name: "Pendiente" },
    },
  });
}

if (pagosACrear.length === 0) { console.log("Todos ya tienen Pago este mes."); return; }

// 4. Crear en batches de 50
const batchSize = 50;
let created = 0;
for (let i = 0; i < pagosACrear.length; i += batchSize) {
  await pagosTbl.createRecordsAsync(pagosACrear.slice(i, i + batchSize));
  created += Math.min(batchSize, pagosACrear.length - i);
}

console.log(`OK: ${created} Pagos de ${detalleKey} creados`);
