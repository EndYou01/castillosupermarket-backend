import {
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import { PatrimonioService } from "./patrimonio.service";

@Controller("patrimonio")
export class PatrimonioController {
  constructor(private readonly patrimonioService: PatrimonioService) {}

  // Patrimonio actual (en vivo): CUP y USD.
  @Get()
  async getPatrimonio() {
    return this.patrimonioService.getPatrimonio();
  }

  // Historial de fotos para la tendencia.
  @Get("historial")
  async getHistorial(@Query("limit") limit?: string) {
    const n = limit ? parseInt(limit, 10) : 60;
    return this.patrimonioService.getHistorial(Number.isFinite(n) ? n : 60);
  }

  // Guardar una foto manualmente.
  @Post("snapshot")
  async guardarSnapshot() {
    return this.patrimonioService.guardarSnapshot();
  }

  // Foto automática diaria, disparada por Vercel Cron. Protegida con CRON_SECRET.
  @Get("snapshot-cron")
  async snapshotCron(@Headers("authorization") authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException("Cron no autorizado");
    }
    const snap = await this.patrimonioService.guardarSnapshot();
    return { ok: true, snapshot: snap };
  }
}
