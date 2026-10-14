export type UserRole = 'admin' | 'supervisor' | 'seller' | 'storekeeper' | 'auditor';
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
  unit: string;
  quantity_decimals: number;
  price_cash: number;
  price_transfer: number;
  image_path: string | null;
}

export interface Payment {
  type: PaymentType;
  amount: number;
}

export interface TransferReceipt {
  ci: string;
  fullName: string;
  address: string;
  amount: number;
  rawText: string;
  reference: string;
  receiptDate: string;
  bank?: string;
  beneficiary?: string;
  orderer?: string;
  currency?: string;
  remainingBalance?: string;
  status?: string;
  imageBase64: string;
  reviewed: boolean;
}
export interface SaleSettlement {
  cashReceived: number | null;
  transferReceipt: TransferReceipt | null;
}

export interface Venta {
  id: number;
  session_id: number;
  user: string;
  date: string;
  total: number;
  method: SaleMethod;
  payments: Payment[];
  settlement?: (SaleSettlement & { changeDue: number }) | null;
}

export interface LineaVenta {
  id: number;
  sale_id: number;
  area_id: number | null;
  unit: string;
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

export interface AreaStock {
  area_id: number;
  product_id: number;
  quantity: number;
}

export interface CartItem {
  areaId: number;
  product: Producto;
  quantity: number;
  price: number;
}

export const CASH_DENOMINATIONS = [
  5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
] as const;

export interface DenominationCount {
  denomination: number;
  quantity: number;
}

export interface CashClosureProductCount {
  productId: number;
  productName: string;
  unit: string;
  openingStock: number;
  entries: number;
  exits: number;
  sold: number;
  expectedStock: number;
  physicalStock: number;
  difference: number;
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

export interface CashWithdrawalInput {
  commandId: string;
  amount: number;
  reason: string;
  adminUsername: string;
  adminPassword: string;
}

export type CashDifferenceKind = 'money' | 'withdrawals' | 'inventory';
export interface CashDifferenceInput {
  kind: CashDifferenceKind;
  counted: number;
  transferCount?: number;
  productId?: number;
  reason: string;
  adminUsername: string;
  adminPassword: string;
}
export interface CashDifferenceApproval {
  id: number;
  reason: string;
  authorized_by: string;
  date: string;
  detail: string;
}
export interface CashClosureRecord {
  session_id: number;
  authorized_by: string;
  date: string;
  detail: string;
}

export interface CashClosurePreview {
  sessionId: number;
  fund: number;
  cashSales: number;
  transferSales: number;
  cardSales: number;
  withdrawalTotal: number;
  withdrawals: CashWithdrawal[];
  salesTotal: number;
  products: Omit<CashClosureProductCount, 'physicalStock' | 'difference'>[];
}

export interface CashClosureInput {
  denominations: DenominationCount[];
  coinsCount?: number;
  transferCount: number;
  withdrawalCount: number;
  approvalIds?: number[];
  products: Array<{ productId: number; physicalStock: number }>;
  adminUsername: string;
  adminPassword: string;
}

export interface CashClosureReconciliation {
  cashCount: number;
  expectedCash: number;
  cashDifference: number;
  transferDifference: number;
  withdrawalDifference: number;
  withdrawalTotal: number;
  totalDifference: number;
  products: CashClosureProductCount[];
}

export interface DailyReport {
  totalSales: number;
  cash: number;
  transfer: number;
  card: number;
  salesCount: number;
  byUser: Array<{ user: string; total: number; count: number }>;
  byProduct: Array<{ product: string; unit: string; quantity: number; total: number }>;
  movements: Movimiento[];
  inventory: Producto[];
}

export interface CashSummary {
  salesTotal: number;
  cashSales: number;
  transferSales: number;
  cardSales: number;
  expectedCash: number;
  withdrawalTotal: number;
}
