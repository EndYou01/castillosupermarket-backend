export interface IVentasResponse {
  ventaBruta: number;
  reembolsos: number;
  ventaNeta: number;
  costoTotal: number;
  beneficioBruto: number;
  recibosProcesados: number;
  distribucion: {
    gastosExtras: number;
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

export interface IGastosExtras {
  fecha: string;
  amount: number;
}

export interface IProductResponse {
  items: IProduct[];
}
export interface IProduct {
  id:                  string;
  handle:              string;
  reference_id:        null;
  item_name:           string;
  description:         null;
  track_stock:         boolean;
  sold_by_weight:      boolean;
  is_composite:        boolean;
  use_production:      boolean;
  category_id:         null;
  components:          any[];
  primary_supplier_id: null;
  tax_ids:             any[];
  modifier_ids:        any[];
  form:                string;
  color:               string;
  image_url:           string;
  option1_name:        null;
  option2_name:        null;
  option3_name:        null;
  created_at:          Date;
  updated_at:          Date;
  deleted_at:          null;
  variants:            Variant[];
}

export interface Variant {
  variant_id:           string;
  item_id:              string;
  sku:                  string;
  reference_variant_id: null;
  option1_value:        null;
  option2_value:        null;
  option3_value:        null;
  barcode:              null;
  cost:                 number;
  purchase_cost:        null;
  default_pricing_type: string;
  default_price:        number;
  stores:               Store[];
  created_at:           Date;
  updated_at:           Date;
  deleted_at:           null;
}

export interface Store {
  store_id:           string;
  pricing_type:       string;
  price:              number;
  available_for_sale: boolean;
  optimal_stock:      null;
  low_stock:          null;
}
