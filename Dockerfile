# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build

# Generar cliente de Prisma para producción
RUN npx prisma generate

# ── Stage 2: Production ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Solo dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copiar build y prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY prisma.config.ts ./

EXPOSE 3001

# Correr migraciones y arrancar
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
