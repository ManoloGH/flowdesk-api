const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DB_URL });

async function main() {
  await c.connect();
  const { rows } = await c.query(
    `SELECT id, empresa FROM "MentoriaCliente" WHERE empresa ILIKE '%anahuac%' OR empresa ILIKE '%textil%'`
  );
  console.log('CLIENTES:', JSON.stringify(rows, null, 2));
  if (rows.length > 0) {
    const clienteId = rows[0].id;
    const { rows: r2 } = await c.query(`SELECT cubo FROM "MentoriaCliente" WHERE id = $1`, [clienteId]);
    const cubo = r2[0]?.cubo ?? {};
    console.log('\nCLIENTE_ID:', clienteId);
    for (const k of Object.keys(cubo)) {
      console.log(`\n=== ${k.toUpperCase()} (${(cubo[k] ?? '').length} chars) ===`);
      console.log(cubo[k] ?? '(vacío)');
    }
  }
  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
