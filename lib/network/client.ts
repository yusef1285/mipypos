import type { DailyReport, Payment, Producto, SaleMethod, SesionCaja } from '@/lib/models';
import { clearNetworkToken, getNetworkToken, saveNetworkToken } from '@/lib/network/config';
import type {
  ApiResult,
  NetworkSaleCommand,
  NetworkSession,
  NetworkSnapshot,
} from '@/lib/network/types';

async function request<T>(hostUrl: string, path: string, body: object): Promise<T> {
  const response = await fetch(`${hostUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result: ApiResult<T> = await response.json();
  if (!response.ok || !result.ok || result.data === undefined)
    throw new Error(result.error ?? 'No se pudo comunicar con el teléfono administrador.');
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

export async function getHostSnapshot(hostUrl: string): Promise<NetworkSnapshot> {
  const token = await getNetworkToken();
  if (!token) throw new Error('Inicia sesión nuevamente en el teléfono administrador.');
  return request<NetworkSnapshot>(hostUrl, '/v1/snapshot', { token });
}

export async function registerHostSale(
  hostUrl: string,
  input: Omit<NetworkSaleCommand, 'token'>,
): Promise<number> {
  const token = await getNetworkToken();
  if (!token) throw new Error('Inicia sesión nuevamente en el teléfono administrador.');
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
  if (!token) throw new Error('Inicia sesión nuevamente en el teléfono administrador.');
  return request<DailyReport>(hostUrl, '/v1/report', { token });
}

export type HostSessionState = SesionCaja | null;
export type HostSalePayment = Payment;
export type HostSaleMethod = SaleMethod;
