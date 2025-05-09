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
  private readonly store_id: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>('LOYVERSE_TOKEN');
    this.store_id = this.configService.get<string>('STORE_ID');
  }

  @Get('rango')
  async obtenerVentasPorRango(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
  ) {
    let allReceipts: any[] = [];
    let cursor: string | null = null;

    try {
      do {
        const queryParams = new URLSearchParams({
          store_id: this.store_id,
          created_at_min: desde,
          created_at_max: hasta,
          limit: '250',
        });

        if (cursor) {
          queryParams.set('cursor', cursor);
        }

        const url = `${this.BASE_URL}?${queryParams.toString()}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.loyverseToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (response.status === 429) {
          console.warn('🔁 Rate limit alcanzado. Esperando 60 segundos...');
          await new Promise((r) => setTimeout(r, 60000));
          continue; // intenta otra vez
        }

        if (!response.ok) {
          const errorBody: any = await response.json();
          console.error('❌ Error en respuesta de Loyverse:', errorBody);
          throw new InternalServerErrorException(
            errorBody.errors?.[0]?.details || 'Error en la API de Loyverse',
          );
        }

        const data: any = await response.json();
        const receipts = data.receipts ?? [];
        cursor = data.cursor ?? null;

        allReceipts = allReceipts.concat(receipts);

        // Espera 500ms para evitar bloqueo
        await new Promise((r) => setTimeout(r, 500));
      } while (cursor);

      // Procesamiento de recibos
      let ventaBruta = 0;
      let reembolsos = 0;
      let costoTotal = 0;

      for (const recibo of allReceipts) {
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
        recibosProcesados: allReceipts.length,
      };
    } catch (error) {
      console.error('🚨 Error al obtener ventas:', error);
      throw new InternalServerErrorException(
        'No se pudo obtener la información de ventas',
      );
    }
  }
}
