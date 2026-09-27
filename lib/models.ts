export type UserRole = 'admin' | 'supervisor' | 'seller' | 'storekeeper';
export type SaleMethod = 'cash' | 'transfer' | 'card' | 'mixed';
export type PaymentType = Exclude<SaleMethod, 'mixed'>;
export type MovementType = 'entrada' | 'salida' | 'traslado';
export type LicenseMode = 'demo' | 'pro';

export interface Usuario {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
}

export interface Producto {
  id: number;
  name: string;
  category: string;
  subcategory: string;
  stock: number;
  price_cash: number;
  price_transfer: number;
  image_path: string | null;
}

export interface Payment {
  type: PaymentType;
  amount: number;
}

export interface Venta {
  id: number;
  session_id: number;
  user: string;
  date: string;
  total: number;
  method: SaleMethod;
  payments: Payment[];
}

export interface LineaVenta {
  id: number;
  sale_id: number;
  product_id: number;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface SesionCaja {
  id: number;
  open_date: string;
  close_date: string | null;
  fund: number;
  final_cash: number | null;
  expected_cash: number | null;
  transfer_total: number | null;
  products_start: Record<string, number>;
  products_end: Record<string, number> | null;
  cash_count: number | null;
  transfer_count: number | null;
}

export interface Area {
  id: number;
  name: string;
}

export interface Movimiento {
  id: number;
  type: MovementType;
  product_id: number;
  product_name: string;
  from_area: string | null;
  to_area: string | null;
  quantity: number;
  user: string;
  date: string;
}

export interface CartItem {
  product: Producto;
  quantity: number;
  price: number;
}

export interface DailyReport {
  totalSales: number;
  cash: number;
  transfer: number;
  card: number;
  salesCount: number;
  byUser: Array<{ user: string; total: number; count: number }>;
  byProduct: Array<{ product: string; quantity: number; total: number }>;
  movements: Movimiento[];
  inventory: Producto[];
}

export interface CashSummary {
  salesTotal: number;
  cashSales: number;
  transferSales: number;
  cardSales: number;
  expectedCash: number;
}
