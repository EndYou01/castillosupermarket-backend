import { Controller, Get, Query } from "@nestjs/common";
import { IVentasResponse } from "src/interfaces/interfaces";
import { VentasService } from "./ventas.service";

@Controller("ventas")
export class VentasController {
  constructor(private readonly ventasService: VentasService) {}

  @Get("rango")
  async obtenerVentasPorRango(
    @Query("desde") desde: string,
    @Query("hasta") hasta: string
  ): Promise<IVentasResponse> {
    return this.ventasService.obtenerVentasPorRango(desde, hasta);
  }
}
