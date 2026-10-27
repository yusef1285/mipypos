export type UserRole = 'admin' | 'supervisor' | 'seller' | 'storekeeper' | 'auditor';
export type SaleMethod = 'cash' | 'transfer' | 'mixed';
export type PaymentType = 'cash' | 'transfer';
// Only persisted sales and historical payments may contain card.
export type LegacySaleMethod = SaleMethod | 'card';
export interface Payment {
  type: PaymentType;
  amount: number;
}
export interface LegacyPayment {
  type: PaymentType | 'card';
  amount: number;
}
export type MovementType =
  | 'entrada'
  | 'salida'
  | 'traslado'
  | 'CONSUMO_INTERNO'
  | 'ANULACION_CONSUMO'
  | 'DEVOLUCION';
export type LicenseMode = 'demo' | 'pro';

export interface Usuario {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  can_authorize_consumption: 0 | 1;
}

export interface Producto {
  id: number;
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  quantity_decimals: number;
  stock: number;
  price_cash: number;
  price_transfer: number;
  image_path: string | null;
  // Cost is managed separately from the product editor and can be unknown.
  unit_cost?: number | null;
}

export interface Area {
  id: number;
  name: string;
}
export interface AreaStock {
  area_id: number;
  product_id: number;
  quantity: number;
}
export interface CartItem {
  product: Producto;
  areaId: number;
  quantity: number;
  price: number;
}

export interface TransferReceipt {
  ci: string;
  fullName: string;
  address: string;
  amount: number;
  rawText: string;
  reference: string;
  receiptDate: string;
  imageBase64: string;
  reviewed: boolean;
  bank?: string;
  beneficiary?: string;
  orderer?: string;
  currency?: string;
  remainingBalance?: string;
  status?: string;
}
export interface SaleSettlement {
  cashReceived: number | null;
  transferReceipt: TransferReceipt | null;
}

// Read model: card remains visible without being accepted by sale commands.
export interface Venta {
  id: number;
  session_id: number;
  user: string;
  seller_id: number | null;
  date: string;
  total: number;
  method: LegacySaleMethod;
  payments: LegacyPayment[];
  settlement: (SaleSettlement & { changeDue: number }) | null;
}
export interface LineaVenta {
  id: number;
  sale_id: number;
  product_id: number;
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  area_id: number | null;
  unit: string;
  unit_cost: number | null;
  category: string;
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
  movement_start_id: number | null;
}

// Bill series used by BanknoteThumbnail; coins are counted separately.
export const CASH_DENOMINATIONS = [
  5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
] as const;

export interface CashWithdrawalInput {
  commandId: string;
  amount: number;
  reason: string;
  adminUsername: string;
  adminPassword: string;
}
export interface CashWithdrawal {
  id: number;
  session_id: number;
  command_id: string;
  amount: number;
  reason: string;
  username: string;
  authorized_by: string;
  date: string;
}
export interface CashSummary {
  salesTotal: number;
  cashSales: number;
  transferSales: number;
  cardSales: number;
  withdrawalTotal: number;
  expectedCash: number;
}
export interface CashClosureProduct {
  productId: number;
  productName: string;
  unit: string;
  openingStock: number;
  entries: number;
  exits: number;
  sold: number;
  expectedStock: number;
}
export interface CashClosurePreview {
  sessionId: number;
  fund: number;
  cashSales: number;
  transferSales: number;
  cardSales: number;
  salesTotal: number;
  withdrawalTotal: number;
  withdrawals: CashWithdrawal[];
  products: CashClosureProduct[];
}
export interface CashClosureProductCount extends CashClosureProduct {
  physicalStock: number;
  difference: number;
}
export interface CashClosureInput {
  denominations: Array<{ denomination: number; quantity: number }>;
  coinsCount?: number;
  transferCount: number;
  withdrawalCount: number;
  products: Array<{ productId: number; physicalStock: number }>;
  adminUsername: string;
  adminPassword: string;
  approvalIds?: number[];
}
export interface CashClosureReconciliation {
  cashCount: number;
  expectedCash: number;
  cashDifference: number;
  transferDifference: number;
  withdrawalTotal: number;
  withdrawalDifference: number;
  totalDifference: number;
  products: CashClosureProductCount[];
}
export interface CashDifferenceInput {
  kind: 'money' | 'withdrawals' | 'inventory';
  counted: number;
  transferCount?: number;
  productId?: number;
  reason: string;
  adminUsername: string;
  adminPassword: string;
}
export interface CashDifferenceApproval {
  id: number;
  detail: string;
  reason: string;
  authorized_by: string;
  date: string;
}
export interface CashClosureRecord {
  session_id: number;
  authorized_by: string;
  date: string;
  detail: string;
}
export interface DailyReport {
  totalSales: number;
  salesCount: number;
  cash: number;
  transfer: number;
  card: number;
  byUser: Array<{ user: string; total: number; count: number }>;
  byProduct: Array<{ product: string; unit: string; quantity: number; total: number }>;
  movements: Movimiento[];
  inventory: Producto[];
}
