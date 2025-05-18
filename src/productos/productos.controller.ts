import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Controller("productos")
export class ProductosController {
  private readonly BASE_URL = "https://api.loyverse.com/v1.0";
  private readonly loyverseToken: string;
  private readonly store_id: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
    this.store_id = this.configService.get<string>("STORE_ID");
  }

  @Get()
  async obtenerProductos() {
    try {
      const url = `${this.BASE_URL}/items?limit=250`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.loyverseToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorBody: any = await response.json();
        console.error("❌ Error en respuesta de Loyverse:", errorBody);
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
        );
      }

      const data: any = await response.json();

      return {
        ...data ,
        itemsNo: data.items.length
      };
    } catch (error) {
      console.error("🚨 Error al obtener ventas:", error);
      throw new InternalServerErrorException(
        "No se pudo obtener la información de pro"
      );
    }
  }
}
