import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
@Controller('ventas')
export class VentasController {
  private readonly BASE_URL = 'https://api.loyverse.com/v1.0/receipts';

  private readonly loyverseToken: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>('LOYVERSE_TOKEN');
  }
  @Get('rango')
  async obtenerVentasPorRango(
    @Query('store_id') storeId: string,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('limite') limite = '200',
  ) {
    if (!storeId || !desde || !hasta) {
      throw new InternalServerErrorException(
        'Faltan parámetros requeridos: store_id, desde o hasta',
      );
    }

    const queryParams = new URLSearchParams({
      store_id: storeId,
      created_at_min: desde,
      created_at_max: hasta,
      limit: limite,
    });

    const url = `${this.BASE_URL}?${queryParams.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.loyverseToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.json();
        console.error('❌ Error en respuesta de Loyverse:', errorBody);
        throw new InternalServerErrorException(
          errorBody.errors?.[0]?.details || 'Error en la API de Loyverse',
        );
      }

      const { receipts } = await response.json();

      if (!Array.isArray(receipts)) {
        throw new InternalServerErrorException('Formato de datos inválido');
      }

      let ventaBruta = 0;
      let reembolsos = 0;
      let costoTotal = 0;

      for (const recibo of receipts) {
        const factor =
          recibo.receipt_type === 'SALE'
            ? 1
            : recibo.receipt_type === 'REFUND'
              ? -1
              : 0;

        const totalRecibo = recibo.total_money ?? 0;
        const lineItems = recibo.line_items ?? [];

        if (factor === 1) {
          ventaBruta += totalRecibo;
        } else if (factor === -1) {
          reembolsos += totalRecibo;
        }

        for (const item of lineItems) {
          const cost = item.cost ?? 0;
          const quantity = item.quantity ?? 0;
          costoTotal += factor * cost * quantity;
        }
      }

      const ventaNeta = ventaBruta - reembolsos;
      const beneficioBruto = ventaNeta - costoTotal;

      return {
        ventaBruta,
        reembolsos,
        ventaNeta,
        costoTotal,
        beneficioBruto,
        recibosProcesados: receipts.length,
      };
    } catch (error) {
      console.error('🚨 Error al obtener ventas:', error);
      throw new InternalServerErrorException(
        'No se pudo obtener la información de ventas',
      );
    }
  }
}
