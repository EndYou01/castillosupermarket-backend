export interface IVentasResponse {
  ventaBruta: number;
  reembolsos: number;
  ventaNeta: number;
  costoTotal: number;
  beneficioBruto: number;
  recibosProcesados: number;
  distribucion: {
    diasProcesados: number;
    gananciaNeta: number;
    pagoTrabajadores: number;
    pagoImpuestos: number;
    administradores: {
      total: number;
      alfonso: number;
      jose: number;
    };
    inversores: {
      total: number;
      senjudo: number;
      adalberto: number;
    };
    reinversion: number;
  };
}
