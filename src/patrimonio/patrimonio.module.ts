import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PatrimonioController } from "./patrimonio.controller";
import { PatrimonioService } from "./patrimonio.service";
import { PatrimonioSnapshot } from "./patrimonio.entity";
import { Capital } from "../capital/capital.entities";
import { ProductosModule } from "../productos/productos.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([PatrimonioSnapshot, Capital]),
    ProductosModule,
  ],
  controllers: [PatrimonioController],
  providers: [PatrimonioService],
})
export class PatrimonioModule {}
