import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  
  // URL de conexión de Supabase (usa variable de entorno en producción)
  url: process.env.DATABASE_URL || 'postgresql://postgres:FMTH8zqj86py-6@db.bpopnlwahfywxhambicw.supabase.co:5432/postgres',
  
  // Configuración SSL para Supabase (requerida)
  ssl: {
    rejectUnauthorized: false,
  },
  
  // Configuración de entidades
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  
  // Configuración de desarrollo (cambiar en producción)
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  
  // Configuración de pool de conexiones optimizada para Supabase
  extra: {
    connectionLimit: 10,
    // Configuraciones adicionales para Supabase
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  
  // Configuración de migraciones
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  migrationsRun: process.env.NODE_ENV !== 'production', // Solo en desarrollo
};