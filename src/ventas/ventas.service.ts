import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DateTime } from "luxon";
import { IReceipt, IVentasResponse } from "src/interfaces/interfaces";
import { gastosExtras, estimuloConfig, limpiezaConfig } from "../static/staticData";

@Injectable()
export class VentasService {
  private readonly BASE_URL = "https://api.loyverse.com/v1.0/receipts";
  private readonly loyverseToken: string;
  private readonly store_id: string;

  constructor(private readonly configService: ConfigService) {
    this.loyverseToken = this.configService.get<string>("LOYVERSE_TOKEN");
    this.store_id = this.configService.get<string>("STORE_ID");
  }

  async obtenerVentasPorRango(
    desde: string,
    hasta: string
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
      let descuentoFiscalTotal = 0;

      // Nuevo procesamiento de métodos de pago
      const metodosPagoMap = new Map<string, number>();

      // Beneficio bruto por día (para cálculo de distribución por día)
      const beneficioBrutoPorDia = new Map<string, number>();

      // Dinero que entra por "Tarjeta Fiscal" por día. Es lo que se transfiere a
      // esa tarjeta para, a fin de mes, pagar los impuestos. Reemplaza al antiguo
      // "impuestos" fijo de 2000/día: ahora es variable según lo que pasó ese día.
      const tarjetaFiscalPorDia = new Map<string, number>();

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

        // Procesar métodos de pago (y el descuento fiscal del 6%)
        let descuentoFiscalRecibo = 0;
        for (const payment of payments) {
          const paymentName = payment.name ?? "Sin nombre";
          const paymentAmount = (payment.money_amount ?? 0) * factor;

          if (paymentName === "Tarjeta Fiscal") {
            descuentoFiscalRecibo += paymentAmount * 0.06;
            tarjetaFiscalPorDia.set(
              fechaRecibo,
              (tarjetaFiscalPorDia.get(fechaRecibo) ?? 0) + paymentAmount
            );
          }

          if (metodosPagoMap.has(paymentName)) {
            metodosPagoMap.set(
              paymentName,
              metodosPagoMap.get(paymentName)! + paymentAmount
            );
          } else {
            metodosPagoMap.set(paymentName, paymentAmount);
          }
        }

        // El 6% de Tarjeta Fiscal es un costo real: se resta de la ganancia bruta.
        descuentoFiscalTotal += descuentoFiscalRecibo;
        beneficioReciboDia -= descuentoFiscalRecibo;

        beneficioBrutoPorDia.set(
          fechaRecibo,
          (beneficioBrutoPorDia.get(fechaRecibo) ?? 0) + beneficioReciboDia
        );
      }

      const ventaNeta = ventaBruta - reembolsos;
      const beneficioBruto = ventaNeta - costoTotal - descuentoFiscalTotal;

      // Convertir Map a array para métodos de pago
      const metodos_pago = Array.from(metodosPagoMap.entries()).map(
        ([name, money_amount]) => ({
          name,
          money_amount,
          descuento:
            name === "Tarjeta Fiscal" ? Math.round(money_amount * 0.06) : 0,
        })
      );

      // Lógica de distribución (calculada día por día)
      const calcularDistribucion = () => {
        const salarioDia = 2000;
        const reinversionDiaria = 1500;

        // Calcular días del rango usando Luxon consistentemente
        const fechaInicio = DateTime.fromISO(desde, {
          zone: "America/Havana",
        }).startOf("day");
        const fechaFin = DateTime.fromISO(hasta, {
          zone: "America/Havana",
        }).endOf("day");
        const dias = Math.floor(fechaFin.diff(fechaInicio, "days").days) + 1;

        const diasEvaluar = Array.from({ length: dias }, (_, i) =>
          fechaInicio.plus({ days: i }).toFormat("yyyy-MM-dd")
        );

        const diasProcesados = beneficioBrutoPorDia.size;
        const pagoTrabajadoresTotal = salarioDia * diasProcesados;

        let totalImpuestos = 0;
        let totalGastosExtras = 0;
        let totalReinversion = 0;
        let totalJefes = 0;
        let totalEstimulo = 0;
        let totalLimpieza = 0;

        const anchorEstimulo = DateTime.fromISO(estimuloConfig.anchor, {
          zone: "America/Havana",
        });

        for (const dia of diasEvaluar) {
          const beneficioDia = beneficioBrutoPorDia.get(dia) ?? 0;
          const tuvoVentas = beneficioBrutoPorDia.has(dia);
          const pagoTrabajadoresDia = tuvoVentas ? salarioDia : 0;

          // "Impuestos" del día = lo que entró por Tarjeta Fiscal ese día. Es el
          // dinero que se aparta (en esa tarjeta) para pagar impuestos a fin de
          // mes; variable, ya no fijo. Reduce la ganancia de los jefes.
          const impuestosDia = tarjetaFiscalPorDia.get(dia) ?? 0;
          totalImpuestos += impuestosDia;

          const gastoDia =
            gastosExtras.find((g) => g.fecha === dia)?.amount ?? 0;
          totalGastosExtras += gastoDia;

          // Estímulo (200, patrón "2 días sí / 2 días no") y limpieza/Mary (1000 los
          // domingos). Ambos se rebajan de la reinversión base de 1500, así que la
          // reinversión real del día puede ser 1500 / 1300 / 500 / 200.
          const fecha = DateTime.fromISO(dia, { zone: "America/Havana" });
          const diasDesdeAnchor = Math.floor(
            fecha.diff(anchorEstimulo, "days").days
          );
          const enCicloEstimulo = (((diasDesdeAnchor % 4) + 4) % 4) < 2;
          const estimuloDia =
            tuvoVentas && enCicloEstimulo ? estimuloConfig.monto : 0;
          const limpiezaDia =
            tuvoVentas && fecha.weekday === 7 ? limpiezaConfig.monto : 0;
          totalEstimulo += estimuloDia;
          totalLimpieza += limpiezaDia;

          const gananciaSinReinversion =
            beneficioDia - pagoTrabajadoresDia - impuestosDia - gastoDia;

          // La reinversión base (1500) se reserva antes de que cobren los jefes;
          // de ella salen el estímulo y la limpieza. Si el día no cubre la base,
          // los jefes ganan 0 y la reinversión absorbe la diferencia.
          if (gananciaSinReinversion >= reinversionDiaria) {
            totalReinversion += reinversionDiaria - estimuloDia - limpiezaDia;
            totalJefes += gananciaSinReinversion - reinversionDiaria;
          } else {
            totalReinversion += gananciaSinReinversion - estimuloDia - limpiezaDia;
          }
        }

        const gananciaNeta = totalJefes;
        const parteCadaJefe = totalJefes * 0.25;

        return {
          diasProcesados,
          gananciaNeta,
          pagoTrabajadores: pagoTrabajadoresTotal,
          pagoImpuestos: totalImpuestos,
          gastosExtras: totalGastosExtras,
          reinversion: totalReinversion,
          estimulo: totalEstimulo,
          limpieza: totalLimpieza,
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
        descuentoFiscal: Math.round(descuentoFiscalTotal),
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
