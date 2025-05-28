// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = [
    'http://localhost:5173',
    'https://castillosupermarket-admin.vercel.app',
    'https://castillosupermarket-store.vercel.app'
  ];

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Postman, curl, etc.
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: Origin no permitido -> ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true, // Necesario si usas cookies o auth headers
    optionsSuccessStatus: 200, // algunos navegadores viejos usan 204
  });

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
