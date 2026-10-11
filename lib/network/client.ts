import type { DailyReport, Payment, Producto, SaleMethod, SesionCaja } from '@/lib/models';
import { clearNetworkToken, getNetworkToken, saveNetworkToken } from '@/lib/network/config';
import type {
  ApiResult,
  NetworkSaleCommand,
  NetworkSession,
  NetworkSnapshot,
} from '@/lib/network/types';

import type { PosOperation, PosArgs, PosResult } from '@/lib/network/operations';

export async function requestHostOperation<K extends PosOperation>(
  hostUrl: string,
  operation: K,
  args: PosArgs<K>,
): Promise<PosResult<K>> {
  const token = await getNetworkToken();
  if (!token) throw new Error('Inicia sesión en el teléfono administrador.');
  return request<PosResult<K>>(hostUrl, '/v1/operation', { operation, args, token });
}

export async function checkLanHost(hostUrl: string) {
  const response = await fetch(`${hostUrl}/v1/health`, { signal: AbortSignal.timeout(8000) });
  const result: ApiResult<{
    name: string;
    protocol: number;
    ready: boolean;
  }> = await response.json();
  if (
    !response.ok ||
    !result.ok ||
    result.data?.name !== 'MipyPOS' ||
    result.data.protocol !== 2 ||
    !result.data.ready
  )
    throw new Error('El administrador no está disponible o necesita actualizar MipyPOS.');
}

export class HostRejection extends Error {
  constructor(
    message: string,
    public readonly code: 'AUTH_EXPIRED' | 'REJECTED',
  ) {
    super(message);
  }
}

async function request<T>(hostUrl: string, path: string, body: object): Promise<T> {
  const response = await fetch(`${hostUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result: ApiResult<T> = await response.json();
  if (!result.ok)
    throw new HostRejection(
      result.error ?? 'El administrador rechazó la operación.',
      result.code ?? 'REJECTED',
    );
  if (!response.ok || result.data === undefined)
    throw new Error('No se pudo confirmar la respuesta del administrador.');
  return result.data;
}

export async function loginToHost(hostUrl: string, username: string, password: string) {
  const session = await request<NetworkSession>(hostUrl, '/v1/login', { username, password });
  await saveNetworkToken(session.token);
  return session.user;
}

export async function logoutFromHost() {
  await clearNetworkToken();
}

const snapshotRequests = new Map<string, Promise<NetworkSnapshot>>();
export function getHostSnapshot(hostUrl: string): Promise<NetworkSnapshot> {
  const existing = snapshotRequests.get(hostUrl);
  if (existing) return existing;
  const pending = (async () => {
    const token = await getNetworkToken();
    if (!token)
      throw new HostRejection(
        'Inicia sesión nuevamente en el teléfono administrador.',
        'AUTH_EXPIRED',
      );
    return request<NetworkSnapshot>(hostUrl, '/v1/snapshot', { token });
  })().finally(() => snapshotRequests.delete(hostUrl));
  snapshotRequests.set(hostUrl, pending);
  return pending;
}

export async function registerHostSale(
  hostUrl: string,
  input: Omit<NetworkSaleCommand, 'token'>,
): Promise<number> {
  const token = await getNetworkToken();
  if (!token)
    throw new HostRejection(
      'Inicia sesión nuevamente en el teléfono administrador.',
      'AUTH_EXPIRED',
    );
  const result = await request<{ saleId: number }>(hostUrl, '/v1/sale', { ...input, token });
  return result.saleId;
}

export async function listHostProducts(hostUrl: string, search = ''): Promise<Producto[]> {
  const snapshot = await getHostSnapshot(hostUrl);
  const query = search.trim().toLocaleLowerCase();
  return query
    ? snapshot.products.filter((product) =>
        `${product.name} ${product.category} ${product.subcategory}`
          .toLocaleLowerCase()
          .includes(query),
      )
    : snapshot.products;
}

export async function getHostReport(hostUrl: string): Promise<DailyReport> {
  const token = await getNetworkToken();
  if (!token)
    throw new HostRejection(
      'Inicia sesión nuevamente en el teléfono administrador.',
      'AUTH_EXPIRED',
    );
  return request<DailyReport>(hostUrl, '/v1/report', { token });
}

export type HostSessionState = SesionCaja | null;
export type HostSalePayment = Payment;
export type HostSaleMethod = SaleMethod;
