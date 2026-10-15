export interface AuthorizationProof {
  username: string;
  passwordHash: string;
}
export interface ConsumptionInput {
  commandId: string;
  productId: number;
  areaId: number;
  quantity: number;
  reason: string;
  notes: string;
  authorization: AuthorizationProof;
  replacesId?: string;
  correctionReason?: string;
}
export const CONSUMPTION_REASONS = [
  'Consumo del propietario',
  'Consumo del encargado',
  'Consumo de trabajadores',
  'Uso interno',
  'Otro motivo',
] as const;
export interface ConsumptionRecord {
  id: string;
  date: string;
  product_id: number;
  product_name: string;
  area_id: number;
  quantity: number;
  price: number;
  unit_cost: number | null;
  value: number;
  cost: number | null;
  reason: string;
  notes: string;
  actor_id: number;
  actor_name: string;
  authorizer_id: number;
  authorizer_name: string;
  status: 'confirmado' | 'anulado' | 'rectificado';
  replaces_id: string | null;
}
export interface CostInput {
  commandId: string;
  productId: number;
  cost: number | null;
  reason: string;
}
export interface PurchaseInput {
  commandId: string;
  productId: number;
  areaId: number;
  quantity: number;
  cost: number;
  reason: string;
}
export interface ConsumptionVoidInput {
  id: string;
  commandId: string;
  reason: string;
  authorization: AuthorizationProof;
}
export interface SaleAdjustmentInput {
  commandId: string;
  saleId: number;
  kind: 'devolucion' | 'anulacion' | 'descuento';
  lineId?: number;
  quantity?: number;
  amount?: number;
  reason: string;
  authorization: AuthorizationProof;
}
export interface FinanceFilter {
  start: string;
  end: string;
  sellerKey?: string;
  productId?: number;
  category?: string;
}
export interface FinanceTotals {
  gross: number;
  discounts: number;
  returns: number;
  net: number;
  knownCost: number;
  profit: number | null;
  margin: number | null;
  units: number;
  operations: number;
  average: number;
  missingCostLines: number;
}
export interface FinanceGroup extends FinanceTotals {
  key: string;
  name: string;
}
export interface FinanceReport {
  currency: 'CUP';
  filter: FinanceFilter;
  totals: FinanceTotals;
  sellers: FinanceGroup[];
  products: FinanceGroup[];
  timeline: FinanceGroup[];
  consumption: { quantity: number; value: number; knownCost: number; missingCost: number };
  inventory: { knownValue: number; missingCost: number; asOf: string };
}
export interface FinanceEntry {
  key: string;
  sellerKey: string;
  seller: string;
  productId: number;
  product: string;
  category: string;
  date: string;
  saleId: number;
  gross: number;
  discounts: number;
  returns: number;
  quantity: number;
  cost: number | null;
}
