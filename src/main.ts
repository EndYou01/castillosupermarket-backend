import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(); // 👈 Habilita CORS para que Vercel pueda acceder
  await app.listen(process.env.PORT || 3000);

}
bootstrap();
