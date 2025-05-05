import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VentasModule } from './ventas/ventas.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    VentasModule,
    ConfigModule.forRoot({
      isGlobal: true, // Disponible en toda la app
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
