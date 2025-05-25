import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VentasModule } from './ventas/ventas.module';
import { ConfigModule } from '@nestjs/config';
import { ProductosModule } from './productos/productos.module';
import { CategoriasModule } from './categorias/categorias.module';

@Module({
  imports: [
    VentasModule,
    ProductosModule,
    CategoriasModule,
    ConfigModule.forRoot({
      isGlobal: true, // Disponible en toda la app
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
