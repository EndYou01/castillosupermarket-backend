import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { ProductosModule } from "../productos/productos.module";

@Module({
  imports: [ProductosModule], // reutiliza el inventario ya cacheado
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
