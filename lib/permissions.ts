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
  | 'seller-performance';

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
  ],
  auditor: ['home', 'reports', 'exports', 'settings', 'audit'],
  supervisor: ['home', 'cash', 'sales', 'reports', 'settings', 'consumption'],
  seller: ['home', 'sales', 'settings', 'consumption'],
  storekeeper: ['home', 'inventory', 'movements', 'products', 'settings', 'consumption'],
};

export function canAccess(role: UserRole | undefined, module: ModuleKey) {
  return Boolean(role && ROLE_MODULES[role].includes(module));
}

export function modulesForRole(role: UserRole) {
  return ROLE_MODULES[role];
}
