import { Controller, Get, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  IInventoryResponse,
  IProduct,
  IProductResponse,
} from "src/interfaces/interfaces";

@Controller("productos")
export class ProductosController {
  private readonly BASE_URL = "https://api.loyverse.com/v1.0";
  private readonly loyverseToken: string;
  private readonly storeId: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
    this.storeId = this.configService.get<string>("STORE_ID");
  }

  @Get()
  async obtenerProductos() {
    try {
      // Obtener productos
      const productsUrl = `${this.BASE_URL}/items?limit=250`;
      const productsResponse = await fetch(productsUrl, {
        headers: {
          Authorization: `Bearer ${this.loyverseToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!productsResponse.ok) {
        const errorBody: any = await productsResponse.json();
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
        );
      }

      const productsData: IProductResponse = await productsResponse.json();

      // Obtener inventario para las cantidades
      const inventoryUrl = `${this.BASE_URL}/inventory?store_id=${this.storeId}&limit=250`;
      const inventoryResponse = await fetch(inventoryUrl, {
        headers: {
          Authorization: `Bearer ${this.loyverseToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!inventoryResponse.ok) {
        const errorBody: any = await inventoryResponse.json();
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details ||
            "Error al obtener inventario de Loyverse"
        );
      }

      const inventoryData: IInventoryResponse = await inventoryResponse.json();

      // Mapear productos con sus cantidades de inventario
      const productosConInventario = productsData.items.map((item) => {
        const variant = item.variants?.[0];
        let quantity = 0;

        // Si el producto rastrea stock y tiene variantes, buscar la cantidad en inventario
        if (item.track_stock && variant) {
          const inventoryItem = inventoryData.inventory_levels.find(
            (invItem) => invItem.variant_id === variant.variant_id
          );
          quantity = inventoryItem?.in_stock || 0;
        }

        return {
          id: item.id,
          description: item.description,
          item_name: item.item_name,
          price: variant?.default_price || 0,
          category_id: item.category_id,
          image_url: item.image_url,
          quantity: quantity,
          track_stock: item.track_stock, // Incluir información de si rastrea stock
        };
      });

      // Filtrar solo productos que rastreen stock y tengan cantidad mayor a 0
      return productosConInventario.filter(
        (producto) => producto.track_stock && producto.quantity > 0
      );
    } catch (error) {
      throw new InternalServerErrorException(
        "No se pudo obtener la información de productos"
      );
    }
  }

  @Get("inventario")
  async obtenerInventario() {
    try {
      // Obtener productos
      const productsUrl = `${this.BASE_URL}/items?limit=250`;
      const productsResponse = await fetch(productsUrl, {
        headers: {
          Authorization: `Bearer ${this.loyverseToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!productsResponse.ok) {
        const errorBody: any = await productsResponse.json();
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
        );
      }

      const productsData: IProductResponse = await productsResponse.json();

      // Obtener inventario
      const inventoryUrl = `${this.BASE_URL}/inventory?store_id=${this.storeId}&limit=250`;
      const inventoryResponse = await fetch(inventoryUrl, {
        headers: {
          Authorization: `Bearer ${this.loyverseToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!inventoryResponse.ok) {
        const errorBody: any = await inventoryResponse.json();
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details ||
            "Error al obtener inventario de Loyverse"
        );
      }

      const inventoryData: IInventoryResponse = await inventoryResponse.json();

      // Filtrar productos que rastrean stock
      const productosConStock = productsData.items.filter(
        (prod) => prod.track_stock
      );

      // Combinar productos con sus cantidades de inventario
      const productosConInventario = productosConStock.map((producto) => {
        const variant = producto.variants?.[0];
        if (!variant) {
          console.warn(`Producto ${producto.item_name} no tiene variantes`);
          return {
            id: producto.id,
            item_name: producto.item_name,
            description: producto.description,
            cost: 0,
            quantity: 0,
            variant_id: null,
          };
        }

        // Buscar la cantidad en inventario usando variant_id
        const inventoryItem = inventoryData.inventory_levels.find(
          (item) => item.variant_id === variant.variant_id
        );

        return {
          id: producto.id,
          item_name: producto.item_name,
          description: producto.description,
          cost: variant.cost || 0,
          quantity: inventoryItem?.in_stock || 0,
          variant_id: variant.variant_id,
          inventory_found: !!inventoryItem, // Para debug
        };
      });

      // Calcular totales solo con productos que tienen variants válidas
      const productosValidos = productosConInventario.filter(
        (p) => p.variant_id !== null
      );

      const totalInvertido = productosValidos.reduce(
        (sum, item) => sum + item.cost * item.quantity,
        0
      );

      const cantidadTotalProductos = productosValidos.reduce(
        (sum, item) => sum + item.quantity,
        0
      );

      return {
        cantidadProductos: productosConStock.length,
        cantidadTotalEnInventario: cantidadTotalProductos,
        totalInvertido: totalInvertido,
        productosConInventario: productosConInventario,
        productosValidosCount: productosValidos.length,
      };
    } catch (error) {
      console.error("Error al obtener inventario:", error);
      throw new InternalServerErrorException(
        "No se pudo obtener la información de inventario"
      );
    }
  }
}