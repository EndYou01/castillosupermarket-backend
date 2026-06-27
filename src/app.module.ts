import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VentasModule } from './ventas/ventas.module';
import { ProductosModule } from './productos/productos.module';
import { CategoriasModule } from './categorias/categorias.module';
import { CapitalModule } from './capital/capital.module';
import { Baja, Capital, MovimientoCapital } from './capital/capital.entities';
import { PatrimonioModule } from './patrimonio/patrimonio.module';
import { PatrimonioSnapshot } from './patrimonio/patrimonio.entity';
import { AnalyticsModule } from './analytics/analytics.module';
// import { UsersModule } from './users/users.module';
// import { AuthModule } from './auth/auth.module';
// import { User } from './users/users.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Disponible en toda la app
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL, // Neon (pooled connection string)
      entities: [Capital, MovimientoCapital, Baja, PatrimonioSnapshot],
      synchronize: true, // crea/actualiza las tablas automáticamente (MVP)
      ssl: { rejectUnauthorized: false }, // requerido por Neon
    }),
    VentasModule,
    ProductosModule,
    CategoriasModule,
    CapitalModule,
    PatrimonioModule,
    AnalyticsModule,
    // AuthModule,
    // UsersModule,

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
