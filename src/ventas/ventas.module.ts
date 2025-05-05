import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';

@Module({
  controllers: [VentasController],
})
export class VentasModule {}
