import type { UserRole } from '@/lib/models';

export type ModuleKey =
  | 'home'
  | 'cash'
  | 'sales'
  | 'inventory'
  | 'movements'
  | 'products'
  | 'reports'
  | 'users'
  | 'exports'
  | 'settings'
  | 'audit'
  | 'consumption'
  | 'investment'
  | 'profitability'
  | 'seller-performance'
  | 'onat';

const ROLE_MODULES: Record<UserRole, readonly ModuleKey[]> = {
  admin: [
    'home',
    'cash',
    'sales',
    'inventory',
    'movements',
    'products',
    'reports',
    'users',
    'exports',
    'settings',
    'audit',
    'consumption',
    'investment',
    'profitability',
    'seller-performance',
    'onat',
  ],
  auditor: ['home', 'reports', 'exports', 'settings', 'audit'],
  supervisor: ['home', 'cash', 'sales', 'reports', 'settings', 'consumption'],
  seller: ['home', 'sales', 'settings', 'consumption'],
  storekeeper: ['home', 'inventory', 'movements', 'products', 'settings', 'consumption'],
};

export function canAccess(
  role: UserRole | undefined,
  module: ModuleKey,
  fiscalPermission?: number,
) {
  if (module === 'onat') return role === 'admin' || Boolean(role && fiscalPermission === 1);
  return Boolean(role && ROLE_MODULES[role].includes(module));
}

export function modulesForRole(role: UserRole) {
  return ROLE_MODULES[role];
}
