import {
  Controller,
  Get,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IProductResponse } from "src/interfaces/interfaces";

@Controller("productos")
export class ProductosController {
  private readonly BASE_URL = "https://api.loyverse.com/v1.0";
  private readonly loyverseToken: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
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
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
        );
      }

      const data: IProductResponse = await response.json();

      return data.items.map((item) => ({
        id: item.id,
        description: item.description,
        item_name: item.item_name,
        price: item.variants[0]?.default_price || 0,
        category_id: item.category_id,
        image_url: item.image_url,
      }));
    } catch (error) {
      throw new InternalServerErrorException(
        "No se pudo obtener la información de productos"
      );
    }
  }
  @Get('inventario')
  async obtenerInventario() {
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
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
        );
      }

      const data: IProductResponse = await response.json();

      console.log(data.items)

      data.items.map((item) => ({
        id: item.id,
        description: item.description,
        item_name: item.item_name,
        price: item.variants[0]?.default_price || 0,
        category_id: item.category_id,
        image_url: item.image_url,
      }));

      return {
        cantidadProductos: data.items.length,
        totalInvertido: 0
      }
    } catch (error) {
      throw new InternalServerErrorException(
        "No se pudo obtener la información de productos"
      );
    }
  }



}
