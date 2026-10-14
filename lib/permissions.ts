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
  | 'audit';

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
  ],
  auditor: ['home', 'reports', 'exports', 'settings', 'audit'],
  supervisor: ['home', 'cash', 'sales', 'reports', 'settings'],
  seller: ['home', 'sales', 'settings'],
  storekeeper: ['home', 'inventory', 'movements', 'products', 'settings'],
};

export function canAccess(role: UserRole | undefined, module: ModuleKey) {
  return Boolean(role && ROLE_MODULES[role].includes(module));
}

export function modulesForRole(role: UserRole) {
  return ROLE_MODULES[role];
}
