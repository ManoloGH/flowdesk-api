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
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main"]
