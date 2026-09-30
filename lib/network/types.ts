import type { Payment, Producto, SaleMethod, SesionCaja, Usuario } from '@/lib/models';

export const LAN_PORT = 8787;

export type NetworkMode = 'standalone' | 'host' | 'client';

export interface NetworkConfig {
  mode: NetworkMode;
  hostUrl: string;
  clientId: string;
}

export interface NetworkSession {
  token: string;
  user: Omit<Usuario, 'password_hash'>;
}

export interface NetworkSnapshot {
  revision: number;
  products: Producto[];
  session: SesionCaja | null;
}

export interface NetworkSaleCommand {
  commandId: string;
  clientId: string;
  token: string;
  method: SaleMethod;
  payments: Payment[];
  items: Array<{ productId: number; quantity: number }>;
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
}
