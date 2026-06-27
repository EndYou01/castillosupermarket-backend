import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import {
  IAnaliticaResponse,
  IAsistenteResponse,
} from "./analytics.interfaces";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // Análisis completo (reposición, márgenes/ABC y combos) de un rango.
  @Get("resumen")
  async obtenerResumen(
    @Query("desde") desde: string,
    @Query("hasta") hasta: string
  ): Promise<IAnaliticaResponse> {
    return this.analyticsService.getAnalitica(desde, hasta);
  }

  // Explicación en lenguaje natural (IA gratuita). Pregunta opcional.
  @Post("asistente")
  async asistente(
    @Body() body: { desde: string; hasta: string; pregunta?: string }
  ): Promise<IAsistenteResponse> {
    return this.analyticsService.asistente(
      body.desde,
      body.hasta,
      body.pregunta
    );
  }
}
