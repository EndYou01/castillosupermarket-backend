import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Put,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { CapitalService, DarBajaDto, DarEntradaDto } from "./capital.service";

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

  // Registrar el cierre de un día (suma venta neta − reparto). Manual.
  @Post("cierre")
  async registrarCierre(@Body() body: { fecha?: string }) {
    return this.capitalService.registrarCierre(body?.fecha);
  }

  // Cierre automático disparado por Vercel Cron. Protegido con CRON_SECRET.
  @Get("cierre-cron")
  async registrarCierreCron(@Headers("authorization") authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException("Cron no autorizado");
    }

    try {
      const resultado = await this.capitalService.registrarCierre();
      return { ok: true, ...resultado };
    } catch (error) {
      // Si el cierre del día ya estaba registrado (p. ej. lo hiciste manual),
      // no es un fallo: respondemos 200 para que el cron no quede en error.
      return {
        ok: false,
        message: error?.message ?? "No se registró el cierre",
      };
    }
  }

  // Lista de bajas de un mes + valor total (al costo).
  @Get("bajas")
  async getBajas(@Query("mes") mes?: string) {
    return this.capitalService.getBajas(mes);
  }

  // Dar baja a un producto (rebaja stock en Loyverse + suma la parte pagada).
  @Post("baja")
  async darBaja(@Body() body: DarBajaDto) {
    return this.capitalService.darBaja(body);
  }

  // Dar entrada a un producto (suma stock, edita costo/precio, resta del capital).
  @Post("entrada")
  async darEntrada(@Body() body: DarEntradaDto) {
    return this.capitalService.darEntrada(body);
  }
}
