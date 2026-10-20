export type UserRole = 'admin' | 'supervisor' | 'seller' | 'storekeeper' | 'auditor';
export type SaleMethod = 'cash' | 'transfer' | 'card' | 'mixed';
// 'card' is intentionally kept in the model for future compatibility, but disabled in runtime.
export type PaymentType = Exclude<SaleMethod, 'mixed'>;
export type MovementType =
  | 'entrada'
  | 'salida'
  | 'traslado'
  | 'CONSUMO_INTERNO'
  | 'ANULACION_CONSUMO'
  | 'DEVOLUCION';
export type LicenseMode = 'demo' | 'pro';
