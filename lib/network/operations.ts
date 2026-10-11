import type * as Database from '@/lib/database';
import type { ModuleKey } from '@/lib/permissions';

export const operationPermissions = {
  listProducts: 'home',
  listAreas: 'home',
  listAreaStock: 'home',
  saveProduct: 'products',
  deleteProduct: 'products',
  importProducts: 'products',
  registerMovement: 'inventory',
  addArea: 'movements',
  listMovements: 'movements',
  listUsers: 'movements',
  saveUser: 'users',
  deleteUser: 'users',
  getCashClosurePreview: 'cash',
  openCashSession: 'cash',
  closeCashSession: 'cash',
  getDailyReport: 'reports',
  getHomeSummary: 'home',
  getExportRows: 'exports',
  getSale: 'sales',
} as const satisfies Partial<Record<keyof typeof Database, ModuleKey>>;
export type PosOperation = keyof typeof operationPermissions;
export type PosArgs<K extends PosOperation> = Parameters<(typeof Database)[K]>;
type LocalPosResult<K extends PosOperation> = Awaited<ReturnType<(typeof Database)[K]>>;
// The host serializes operations without a return value as null.
export type PosResult<K extends PosOperation> =
  | LocalPosResult<K>
  | (void extends LocalPosResult<K> ? null : never);
export type OperationRequest = {
  [K in PosOperation]: { operation: K; args: PosArgs<K>; token: string };
}[PosOperation];
