import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DateTime } from "luxon";
import { IReceipt, IVentasResponse } from "src/interfaces/interfaces";
import { gastosExtras } from '../static/staticData';

@Controller("ventas")
export class VentasController {
  private readonly BASE_URL = "https://api.loyverse.com/v1.0/receipts";
  private readonly loyverseToken: string;
  private readonly store_id: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
    this.store_id = this.configService.get<string>("STORE_ID");
  }

  @Get("rango")
  async obtenerVentasPorRango(
    @Query("desde") desde: string,
    @Query("hasta") hasta: string
  ): Promise<IVentasResponse> {
    let allReceipts: IReceipt[] = [];
    let cursor: string | null = null;

    try {
      do {
        const queryParams = new URLSearchParams({
          store_id: this.store_id,
          created_at_min: desde,
          created_at_max: hasta,
          limit: "250",
        });

        if (cursor) {
          queryParams.set("cursor", cursor);
        }

        const url = `${this.BASE_URL}?${queryParams.toString()}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.loyverseToken}`,
            "Content-Type": "application/json",
          },
        });

        if (response.status === 429) {
          console.warn("🔁 Rate limit alcanzado. Esperando 60 segundos...");
          await new Promise((r) => setTimeout(r, 60000));
          continue; // intenta otra vez
        }

        if (!response.ok) {
          const errorBody: any = await response.json();
          console.error("❌ Error en respuesta de Loyverse:", errorBody);
          throw new InternalServerErrorException(
            errorBody.errors?.[0]?.details || "Error en la API de Loyverse"
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

      // Nuevo procesamiento de métodos de pago
      const metodosPagoMap = new Map<string, number>();

      for (const recibo of allReceipts) {
        
        const factor =
          recibo.receipt_type === "SALE"
            ? 1
            : recibo.receipt_type === "REFUND"
              ? -1
              : 0;

        const totalRecibo = recibo.total_money ?? 0;
        const lineItems = recibo.line_items ?? [];
        const payments = recibo.payments ?? [];

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

        // Procesar métodos de pago
        for (const payment of payments) {
          const paymentName = payment.name ?? "Sin nombre";
          const paymentAmount = (payment.money_amount ?? 0) * factor;
          
          if (metodosPagoMap.has(paymentName)) {
            metodosPagoMap.set(paymentName, metodosPagoMap.get(paymentName)! + paymentAmount);
          } else {
            metodosPagoMap.set(paymentName, paymentAmount);
          }
        }
      }

      const ventaNeta = ventaBruta - reembolsos;
      const beneficioBruto = ventaNeta - costoTotal;

      // Convertir Map a array para métodos de pago
      const metodos_pago = Array.from(metodosPagoMap.entries()).map(([name, money_amount]) => ({
        name,
        money_amount,
        descuento: name === "Tarjeta Fiscal" ? Math.round(money_amount * 0.06) : 0
      }));

      // Lógica de distribución
      const calcularDistribucion = () => {
        let kilos = 0;
        const pagoImpuestosUnitario = 2100;

        // Calcular días del rango
        const fechaInicio = new Date(desde);
        const fechaFin = new Date(hasta);
        const dias =
          Math.ceil(
            (fechaFin.getTime() - fechaInicio.getTime()) /
              (1000 * 60 * 60 * 24) +
              1
          ) - 1;
        const pagoImpuestos = Math.ceil(pagoImpuestosUnitario * dias);

        // Agrupar recibos por día
        const recibosPorDia: Record<string, any[]> = {};

        for (const recibo of allReceipts) {
          const fecha = DateTime.fromISO(recibo.created_at, { zone: "utc" })
            .setZone("America/Havana")
            .toFormat("yyyy-MM-dd");
          if (!recibosPorDia[fecha]) {
            recibosPorDia[fecha] = [];
          }
          recibosPorDia[fecha].push(recibo);
        }

        let pagoTrabajadoresTotal = 0;

        for (const fecha in recibosPorDia) {
          const recibosDelDia = recibosPorDia[fecha];

          let ventaBrutaDia = 0;
          let reembolsosDia = 0;

          for (const recibo of recibosDelDia) {
            const factor =
              recibo.receipt_type === "SALE"
                ? 1
                : recibo.receipt_type === "REFUND"
                  ? -1
                  : 0;

            const totalRecibo = recibo.total_money ?? 0;

            if (factor === 1) {
              ventaBrutaDia += totalRecibo;
            } else if (factor === -1) {
              reembolsosDia += totalRecibo;
            }
          }

          const ventaNetaDia = ventaBrutaDia - reembolsosDia;
          const salarioDia = Math.max(ventaNetaDia * 0.04, 2400);
          pagoTrabajadoresTotal += salarioDia;
        }

        const diasProcesados = Object.keys(recibosPorDia).length;

        let totalGastosExtras = 0;
        const diasEvaluar = Array.from({ length: diasProcesados }, (_, i) =>
          DateTime.fromISO(desde).plus({ days: i }).toFormat("yyyy-MM-dd")
        );

        for (const dia of diasEvaluar) {
          const gasto = gastosExtras.find((g) => g.fecha === dia);
          if (gasto) totalGastosExtras += gasto.amount;
        }

        const gananciaNeta =
          beneficioBruto -
          pagoTrabajadoresTotal -
          pagoImpuestos -
          totalGastosExtras;

        const calcularKilos = (valor: number, acumular = false) => {
          const redondeado = Math.floor(valor / 10) * 10;
          if (acumular) kilos += valor - redondeado;
          return redondeado;
        };

        return {
          diasProcesados,
          gananciaNeta,
          pagoTrabajadores: calcularKilos(pagoTrabajadoresTotal, true),
          pagoImpuestos: calcularKilos(pagoImpuestos, true),
          gastosExtras: calcularKilos(totalGastosExtras, true),
          administradores: {
            total: calcularKilos(gananciaNeta * 0.4),
            alfonso: calcularKilos(gananciaNeta * 0.2, true),
            jose: calcularKilos(gananciaNeta * 0.2, true),
          },
          inversores: {
            total: calcularKilos(gananciaNeta * 0.55),
            senjudo: calcularKilos(gananciaNeta * 0.2688, true),
            adalberto: calcularKilos(gananciaNeta * 0.2811, true),
          },
          reinversion: gananciaNeta * 0.05 + kilos,
        };
      };

      const distribucion = calcularDistribucion();

      return {
        ventaBruta,
        reembolsos,
        ventaNeta,
        costoTotal,
        beneficioBruto,
        recibosProcesados: allReceipts.length,
        distribucion,
        metodos_pago,
      };
    } catch (error) {
      console.error("🚨 Error al obtener ventas:", error);
      throw new InternalServerErrorException(
        "No se pudo obtener la información de ventas"
      );
    }
  }
}