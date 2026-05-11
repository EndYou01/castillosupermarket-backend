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

      // Beneficio bruto por día (para cálculo de distribución por día)
      const beneficioBrutoPorDia = new Map<string, number>();

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

        const fechaRecibo = DateTime.fromISO(recibo.created_at, { zone: "utc" })
          .setZone("America/Havana")
          .toFormat("yyyy-MM-dd");

        let beneficioReciboDia = factor * totalRecibo;
        for (const item of lineItems) {
          const cost = item.cost ?? 0;
          const quantity = item.quantity ?? 0;
          const costoItem = factor * cost * quantity;
          costoTotal += costoItem;
          beneficioReciboDia -= costoItem;
        }

        beneficioBrutoPorDia.set(
          fechaRecibo,
          (beneficioBrutoPorDia.get(fechaRecibo) ?? 0) + beneficioReciboDia
        );

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

      // Lógica de distribución (calculada día por día)
      const calcularDistribucion = () => {
        const pagoImpuestosUnitario = 2000;
        const salarioDia = 2000;
        const reinversionDiaria = 1500;

        // Calcular días del rango usando Luxon consistentemente
        const fechaInicio = DateTime.fromISO(desde, { zone: "America/Havana" }).startOf('day');
        const fechaFin = DateTime.fromISO(hasta, { zone: "America/Havana" }).endOf('day');
        const dias = Math.floor(fechaFin.diff(fechaInicio, 'days').days) + 1;

        const diasEvaluar = Array.from({ length: dias }, (_, i) =>
          fechaInicio.plus({ days: i }).toFormat("yyyy-MM-dd")
        );

        const diasProcesados = beneficioBrutoPorDia.size;
        const pagoTrabajadoresTotal = salarioDia * diasProcesados;
        const pagoImpuestos = pagoImpuestosUnitario * dias;

        let totalGastosExtras = 0;
        let totalReinversion = 0;
        let totalJefes = 0;

        for (const dia of diasEvaluar) {
          const beneficioDia = beneficioBrutoPorDia.get(dia) ?? 0;
          const tuvoVentas = beneficioBrutoPorDia.has(dia);
          const pagoTrabajadoresDia = tuvoVentas ? salarioDia : 0;
          const gastoDia = gastosExtras.find((g) => g.fecha === dia)?.amount ?? 0;
          totalGastosExtras += gastoDia;

          const gananciaSinReinversion =
            beneficioDia - pagoTrabajadoresDia - pagoImpuestosUnitario - gastoDia;

          // Si la ganancia del día no cubre la reinversión, los jefes ganan 0
          // y la reinversión absorbe la diferencia (puede quedar < 1500 o negativa).
          if (gananciaSinReinversion >= reinversionDiaria) {
            totalReinversion += reinversionDiaria;
            totalJefes += gananciaSinReinversion - reinversionDiaria;
          } else {
            totalReinversion += gananciaSinReinversion;
          }
        }

        const gananciaNeta = totalJefes;
        const parteCadaJefe = totalJefes * 0.25;

        return {
          diasProcesados,
          gananciaNeta,
          pagoTrabajadores: pagoTrabajadoresTotal,
          pagoImpuestos,
          gastosExtras: totalGastosExtras,
          reinversion: totalReinversion,
          jefes: {
            total: totalJefes,
            alfonso: parteCadaJefe,
            senjudo: parteCadaJefe,
            josse: parteCadaJefe,
            julio: parteCadaJefe,
          },
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