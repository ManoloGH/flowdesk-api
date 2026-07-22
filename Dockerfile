FROM node:22-alpine

WORKDIR /app

# Copiar manifiestos y schema primero (para cache de layers)
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Instalar todas las dependencias (incluye dev para el build)
RUN npm ci

# Copiar el resto del código y compilar
COPY . .
RUN npm run build

EXPOSE 3001

# Correr migraciones y arrancar
CMD ["sh", "-c", "node -e \"const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('UPDATE \\\"_prisma_migrations\\\" SET rolled_back_at=NOW() WHERE finished_at IS NULL AND rolled_back_at IS NULL')).then(r=>{console.log('[fix]',r.rowCount,'resolved');return c.end();}).catch(e=>{console.error('[fix]',e.message);return c.end().catch(()=>{});});\" ; npx prisma migrate deploy && node dist/src/main"]
