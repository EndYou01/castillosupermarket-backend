import {
  Controller,
  Get,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ICategoryResponse } from "src/interfaces/interfaces";

@Controller("categorias")
export class CategoriasController {
  private readonly BASE_URL = "https://api.loyverse.com/v1.0";
  private readonly loyverseToken: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
  }

  @Get()
  async obtenerCategorias() {
    try {
      const url = `${this.BASE_URL}/categories`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.loyverseToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorBody: any = await response.json();
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
        );
      }

      const data: ICategoryResponse = await response.json();

      return data.categories
    } catch (error) {
      throw new InternalServerErrorException(
        "No se pudo obtener la información de productos"
      );
    }
  }
}
