import type {
  Area,
  AreaStock,
  Payment,
  Producto,
  SaleMethod,
  SesionCaja,
  Usuario,
} from '@/lib/models';

export const LAN_PORT = 8787;

export type NetworkMode = 'standalone' | 'host' | 'client';

export interface NetworkConfig {
  mode: NetworkMode;
  hostUrl: string;
  hostPin?: string;
  transport?: 'direct' | 'wifi';
  clientId: string;
}

export interface NetworkSession {
  token: string;
  user: Omit<Usuario, 'password_hash'>;
}

export interface NetworkSnapshot {
  revision: number;
  licenseMode: import('@/lib/models').LicenseMode;
  products: Producto[];
  areas: Area[];
  areaStock: AreaStock[];
  session: SesionCaja | null;
}

export interface NetworkSaleCommand {
  commandId: string;
  clientId: string;
  token: string;
  method: SaleMethod;
  sessionId: number;
  payments: Payment[];
  settlement?: import('@/lib/models').SaleSettlement;
  items: Array<{ productId: number; quantity: number; areaId: number }>;
}

export interface NetworkEvent {
  id: number;
  type: string;
  entity_id: number | null;
  created_at: string;
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: 'AUTH_EXPIRED' | 'REJECTED';
}
