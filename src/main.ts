import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, raw } from 'express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useStaticAssets(join(__dirname, '..', '..', 'public'));

  // Stripe webhook necesita el body sin parsear para verificar la firma HMAC
  app.use('/api/v1/billing/webhook', raw({ type: 'application/json' }));

  // Límite aumentado para importar exports de tenant (pueden pesar varios MB)
  app.use(json({ limit: '50mb' }));

  // Seguridad
  app.use(helmet());

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://flowdesk.mx',
    'https://www.flowdesk.mx',
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  // Validación automática de DTOs
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Documentación automática (Swagger)
  const config = new DocumentBuilder()
    .setTitle('FlowDesk API')
    .setDescription('API del sistema operativo empresarial FlowDesk')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`FlowDesk API corriendo en http://localhost:${port}`);
  console.log(`Documentación en http://localhost:${port}/api/docs`);
}
bootstrap();
