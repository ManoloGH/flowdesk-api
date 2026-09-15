const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DB_URL });
c.connect()
  .then(() => c.query('ALTER TABLE "MentoriaCliente" ADD COLUMN IF NOT EXISTS "chats_agente" JSONB'))
  .then(r => { console.log('OK:', r.command); c.end(); })
  .catch(e => { console.error(e.message); c.end(); process.exit(1); });
