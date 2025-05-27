import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VentasModule } from './ventas/ventas.module';
import { ProductosModule } from './productos/productos.module';
import { CategoriasModule } from './categorias/categorias.module';
// import { UsersModule } from './users/users.module';
// import { AuthModule } from './auth/auth.module';
// import { User } from './users/users.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Disponible en toda la app
    }),
    // TypeOrmModule.forRoot({
    //   type: 'postgres',
    //   host: process.env.DB_HOST,
    //   port: +process.env.DB_PORT,
    //   username: process.env.DB_USERNAME,
    //   password: process.env.DB_PASSWORD,
    //   database: process.env.DB_NAME,
    //   entities: [User],
    //   synchronize: true, // ⚠️ solo para desarrollo
    //   ssl: { rejectUnauthorized: false }, // requerido por Supabase
    // }),
    VentasModule,
    ProductosModule,
    CategoriasModule,
    // AuthModule,
    // UsersModule,

  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
