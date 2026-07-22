'use strict';
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
if (!url) { console.log('[fix] no DATABASE_URL'); process.exit(0); }
const ssl = url.includes('sslmode=require') ? { rejectUnauthorized: false } : false;
const client = new Client({ connectionString: url, ssl });
client.connect()
  .then(() => client.query(
    'UPDATE "_prisma_migrations" SET rolled_back_at = NOW() WHERE finished_at IS NULL AND rolled_back_at IS NULL'
  ))
  .then(r => { console.log('[fix]', r.rowCount, 'migration(s) resolved'); return client.end(); })
  .catch(e => { console.error('[fix] error:', e.message); return client.end().catch(() => {}); });
