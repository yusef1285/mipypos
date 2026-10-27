import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import { getNetworkReplica, storeNetworkReplica } from '@/lib/database';
import { parseSnapshot, unchangedSnapshotSchema } from '@/lib/network/snapshot';
import { pinnedRequest } from '@/lib/network/tls';
import type { DailyReport, Payment, Producto, SaleMethod, SesionCaja } from '@/lib/models';
import {
  clearNetworkToken,
  getNetworkToken,
  saveNetworkToken,
  loadNetworkConfig,
} from '@/lib/network/config';
import { flushRevocations, revokeOrDefer } from '@/lib/network/revocations';
import type { NetworkSaleCommand, NetworkSession, NetworkSnapshot } from '@/lib/network/types';

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
  const result: unknown = JSON.parse(await pinnedRequest(hostUrl, path, body));
  const envelope = z
    .discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), data: z.unknown() }),
      z.object({
        ok: z.literal(false),
        code: z.enum(['AUTH_EXPIRED', 'REJECTED', 'UNKNOWN_OPERATION', 'INVALID_ARGUMENTS']),
        error: z.string().min(1),
      }),
    ])
    .safeParse(result);
  if (!envelope.success) throw new Error('No se pudo confirmar la respuesta del administrador.');
  const confirmed = envelope.data;
  if (!confirmed.ok) {
    if (confirmed.code === 'AUTH_EXPIRED') await clearNetworkToken();
    throw new HostRejection(
      confirmed.error,
      confirmed.code === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'REJECTED',
    );
  }
  if (confirmed.data === undefined)
    throw new Error('No se pudo confirmar la respuesta del administrador.');
  return confirmed.data as T;
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
export async function getHostSnapshot(hostUrl: string): Promise<NetworkSnapshot> {
  const token = await getNetworkToken();
  if (!token)
    throw new HostRejection(
      'Inicia sesión nuevamente en el teléfono administrador.',
      'AUTH_EXPIRED',
    );
  // A cache/in-flight request belongs to the authenticated bearer, not only the
  // URL. Switching accounts must never reuse an administrator's unredacted data.
  const cacheKey = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([hostUrl, token]),
  );
  const existing = snapshotRequests.get(cacheKey);
  if (existing) return existing;
  const pending = (async () => {
    const stored = await getNetworkReplica(cacheKey);
    let cached: NetworkSnapshot | null = null;
    if (stored) {
      try {
        cached = parseSnapshot(JSON.parse(stored.payload));
      } catch {
        cached = null;
      }
    }
    const response = await request<unknown>(hostUrl, '/v1/snapshot', {
      token,
      ...(cached?.authorityId
        ? { knownRevision: cached.revision, authorityId: cached.authorityId }
        : {}),
    });
    const unchanged = unchangedSnapshotSchema.safeParse(response);
    if (unchanged.success) {
      if (
        !cached ||
        cached.revision !== unchanged.data.revision ||
        cached.authorityId !== unchanged.data.authorityId
      )
        throw new Error(
          'La revisión recibida no coincide con la copia local. Vuelve a intentarlo.',
        );
      return cached;
    }
    const snapshot = parseSnapshot(response);
    await storeNetworkReplica(cacheKey, JSON.stringify(snapshot));
    return snapshot;
  })().finally(() => snapshotRequests.delete(cacheKey));
  snapshotRequests.set(cacheKey, pending);
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
  const result = await request<unknown>(hostUrl, '/v1/sale', { ...input, token });
  const confirmed = z.object({ saleId: z.number().int().positive() }).safeParse(result);
  if (!confirmed.success)
    throw new Error('No se pudo confirmar el número de venta. La operación sigue pendiente.');
  return confirmed.data.saleId;
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
