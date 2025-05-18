import { Module } from '@nestjs/common';
import { ProductosController } from './productos.controller';

@Module({
  controllers: [ProductosController],
})
export class ProductosModule {}
