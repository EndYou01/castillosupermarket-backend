import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CapitalController } from "./capital.controller";
import { CapitalService } from "./capital.service";
import { Baja, Capital, MovimientoCapital } from "./capital.entities";
import { VentasModule } from "../ventas/ventas.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Capital, MovimientoCapital, Baja]),
    VentasModule,
  ],
  controllers: [CapitalController],
  providers: [CapitalService],
})
export class CapitalModule {}
