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
  metodos_pago: IMetodoPago[];
}

interface IMetodoPago {
  name: string;
  money_amount: number;
  descuento: number;
}

export interface IGastosExtras {
  fecha: string;
  amount: number;
}

export interface IProductResponse {
  items: IProduct[];
}
export interface IProduct {
  id: string;
  handle: string;
  reference_id: null;
  item_name: string;
  description: null;
  track_stock: boolean;
  sold_by_weight: boolean;
  is_composite: boolean;
  use_production: boolean;
  category_id: number | null;
  components: any[];
  primary_supplier_id: number | null;
  tax_ids: number[];
  modifier_ids: any[];
  form: string;
  color: string;
  image_url: string;
  option1_name: null;
  option2_name: null;
  option3_name: null;
  created_at: Date;
  updated_at: Date;
  deleted_at: null;
  variants: Variant[];
}

export interface Variant {
  variant_id: string;
  item_id: string;
  sku: string;
  reference_variant_id: null;
  option1_value: null;
  option2_value: null;
  option3_value: null;
  barcode: null;
  cost: number;
  purchase_cost: null;
  default_pricing_type: string;
  default_price: number;
  stores: Store[];
  created_at: Date;
  updated_at: Date;
  deleted_at: null;
}

export interface Store {
  store_id: string;
  pricing_type: string;
  price: number;
  available_for_sale: boolean;
  optimal_stock: null;
  low_stock: null;
}

export interface ICategoryResponse {
  categories: ICategory[];
}
export interface ICategory {
  id: string;
  name: string;
  color: string;
  created_at: Date;
  deleted_at: Date | null;
}

export interface IInventoryResponse {
  inventory_levels: {
    variant_id: string;
    store_id: string;
    in_stock: number;
    updated_at: Date;
  }[];
}


export interface ILineItem {
  id: string;
  item_id: string;
  variant_id: string;
  item_name: string;
  variant_name: string | null;
  sku: string;
  quantity: number;
  price: number;
  gross_total_money: number;
  total_money: number;
  cost: number;
  cost_total: number;
  line_note: string | null;
  line_taxes: any[];
  total_discount: number;
  line_discounts: any[];
  line_modifiers: any[];
}

export interface IPayment {
  payment_type_id: string;
  name: string;
  type: string;
  money_amount: number;
  paid_at: string;
  payment_details: any | null;
}

export interface IReceipt {
  receipt_number: string;
  note: string | null;
  receipt_type: string;
  refund_for: string | null;
  order: any | null;
  created_at: string;
  updated_at: string;
  source: string;
  receipt_date: string;
  cancelled_at: string | null;
  total_money: number;
  total_tax: number;
  points_earned: number;
  points_deducted: number;
  points_balance: number;
  customer_id: string | null;
  total_discount: number;
  employee_id: string;
  store_id: string;
  pos_device_id: string;
  dining_option: string | null;
  total_discounts: any[];
  total_taxes: any[];
  tip: number;
  surcharge: number;
  line_items: ILineItem[];
  payments: IPayment[];
}