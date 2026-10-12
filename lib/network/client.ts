import { z } from 'zod';
import { pinnedRequest } from '@/lib/network/tls';
import type { DailyReport, Payment, Producto, SaleMethod, SesionCaja } from '@/lib/models';
import {
  clearNetworkToken,
  getNetworkToken,
  saveNetworkToken,
  loadNetworkConfig,
} from '@/lib/network/config';
import { flushRevocations, revokeOrDefer } from '@/lib/network/revocations';
import type {
  ApiResult,
  NetworkSaleCommand,
  NetworkSession,
  NetworkSnapshot,
} from '@/lib/network/types';

import {
  mutationOperations,
  type PosOperation,
  type PosArgs,
  type PosResult,
} from '@/lib/network/operations';
import {
  prepareOperation,
  getPendingOperation,
  clearPendingOperation,
} from '@/lib/network/pending-operation';

let operationQueue: Promise<unknown> = Promise.resolve();

export async function requestHostOperation<K extends PosOperation>(
  hostUrl: string,
  operation: K,
  args: PosArgs<K>,
  username = '',
  clientId = '',
): Promise<PosResult<K>> {
  const run = async (): Promise<PosResult<K>> => {
    const token = await getNetworkToken();
    if (!token)
      throw new HostRejection('Inicia sesión en el teléfono administrador.', 'AUTH_EXPIRED');
    if (!mutationOperations.has(operation))
      return request<PosResult<K>>(hostUrl, '/v1/operation', { operation, args, token });
    const pending = await prepareOperation({ hostUrl, username, clientId, operation, args });
    try {
      const receipt = await request<{ found: boolean; value: PosResult<K> }>(
        hostUrl,
        '/v1/receipt',
        { ...pending, token },
      );
      const result = receipt.found
        ? receipt.value
        : await request<PosResult<K>>(hostUrl, '/v1/operation', { ...pending, token });
      await clearPendingOperation();
      return result;
    } catch (error) {
      if (error instanceof HostRejection && error.code === 'REJECTED')
        await clearPendingOperation();
      throw error;
    }
  };
  if (!mutationOperations.has(operation)) return run();
  const running = operationQueue.then(run);
  operationQueue = running.catch(() => undefined);
  return running;
}

export async function checkLanHost(hostUrl: string, pin?: string) {
  const result = z
    .object({
      ok: z.literal(true),
      data: z.object({
        name: z.literal('MipyPOS'),
        protocol: z.literal(4),
        ready: z.literal(true),
      }),
    })
    .safeParse(JSON.parse(await pinnedRequest(hostUrl, '/v1/health', undefined, pin)));
  if (!result.success)
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
  const result = JSON.parse(await pinnedRequest(hostUrl, path, body)) as ApiResult<T>;
  if (!result || typeof result.ok !== 'boolean')
    throw new Error('No se pudo confirmar la respuesta del administrador.');
  if (!result.ok) {
    if (result.code === 'AUTH_EXPIRED') await clearNetworkToken();
    throw new HostRejection(
      result.error ?? 'El administrador rechazó la operación.',
      result.code ?? 'REJECTED',
    );
  }
  if (result.data === undefined)
    throw new Error('No se pudo confirmar la respuesta del administrador.');
  return result.data;
}

export async function loginToHost(hostUrl: string, username: string, password: string) {
  await flushRevocations(hostUrl);
  const session = await request<NetworkSession>(hostUrl, '/v1/login', { username, password });
  await saveNetworkToken(session.token);
  const pending = await getPendingOperation();
  if (pending && pending.hostUrl === hostUrl && pending.username === session.user.username) {
    try {
      const receipt = await request<{ found: boolean }>(hostUrl, '/v1/receipt', {
        ...pending,
        token: session.token,
      });
      if (!receipt.found)
        await request(hostUrl, '/v1/operation', { ...pending, token: session.token });
      await clearPendingOperation();
    } catch (error) {
      if (error instanceof HostRejection && error.code === 'REJECTED')
        await clearPendingOperation();
      throw error;
    }
  }
  return session.user;
}

export async function logoutFromHost(hostUrl?: string, hostPin?: string) {
  const token = await getNetworkToken();
  const config = await loadNetworkConfig();
  await clearNetworkToken();
  if (hostUrl && token) await revokeOrDefer(hostUrl, hostPin ?? config.hostPin ?? '', token);
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
