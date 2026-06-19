import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { CapitalService, DarBajaDto } from "./capital.service";

@Controller("capital")
export class CapitalController {
  constructor(private readonly capitalService: CapitalService) {}

  @Get()
  async getCapital() {
    return this.capitalService.getCapital();
  }

  // Fijar el capital a un valor absoluto (botón "Modificar" tras un conteo).
  @Put()
  async setConteo(
    @Body() body: { monto: number; descripcion?: string }
  ) {
    return this.capitalService.setConteo(body.monto, body.descripcion);
  }

  // Registrar el cierre de un día (suma venta neta − reparto).
  @Post("cierre")
  async registrarCierre(@Body() body: { fecha?: string }) {
    return this.capitalService.registrarCierre(body?.fecha);
  }

  // Dar baja a un producto (rebaja stock en Loyverse + suma la parte pagada).
  @Post("baja")
  async darBaja(@Body() body: DarBajaDto) {
    return this.capitalService.darBaja(body);
  }
}
