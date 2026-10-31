import { z } from 'zod';
import * as Crypto from 'expo-crypto';
import { clearNetworkReplicas, getNetworkReplica, storeNetworkReplica } from '@/lib/database';
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
import {
  operationArgs,
  parseOperationResult,
  networkSessionSchema,
  dailyReportSchema,
} from '@/lib/network/validation';
import type { NetworkSaleCommand, NetworkSnapshot } from '@/lib/network/types';

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
  type PendingOperation,
} from '@/lib/network/pending-operation';

async function resolvePendingOperation<T>(
  hostUrl: string,
  pending: PendingOperation,
  token: string,
  parseResult: (value: unknown) => T,
): Promise<T> {
  if (pending.hostPin && pending.hostPin !== (await loadNetworkConfig()).hostPin)
    throw new Error('Confirma la operación pendiente con el administrador original.');
  const lookup = async () => {
    const raw = await request(hostUrl, '/v1/receipt', { ...pending, token }, pending.hostPin);
    const parsed = z
      .discriminatedUnion('found', [
        z.object({ found: z.literal(false) }),
        z.object({ found: z.literal(true), value: z.unknown() }),
      ])
      .safeParse(raw);
    if (!parsed.success) throw new Error('No se pudo confirmar la operación pendiente.');
    const receipt = parsed.data;
    if (receipt.found && receipt.value === undefined)
      throw new Error('No se pudo confirmar la operación pendiente.');
    return receipt;
  };
  // A failed receipt lookup is never evidence of a failed mutation.
  const previous = await lookup();
  if (previous.found) {
    const result = parseResult(previous.value);
    await clearPendingOperation();
    return result;
  }
  let result: T;
  try {
    result = parseResult(
      await request(hostUrl, '/v1/operation', { ...pending, token }, pending.hostPin),
    );
  } catch (error) {
    if (!(error instanceof HostRejection) || error.code !== 'REJECTED') throw error;
    const confirmed = await lookup();
    if (confirmed.found) {
      const receiptResult = parseResult(confirmed.value);
      await clearPendingOperation();
      return receiptResult;
    }
    await clearPendingOperation();
    throw new HostRejection(error.message, 'NOT_COMMITTED');
  }
  await clearPendingOperation();
  return result;
}

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
    if (operation === 'registerCashWithdrawal') {
      const { hostPin } = await loadNetworkConfig();
      const input = operationArgs.registerCashWithdrawal.parse(args);
      const receipt = async () => {
        const value = await request(
          hostUrl,
          '/v1/withdrawal-receipt',
          {
            token,
            sessionId: input[0],
            commandId: input[1].commandId,
            amount: input[1].amount,
            reason: input[1].reason,
          },
          hostPin,
        );
        const parsed = z
          .object({ withdrawalId: z.number().int().positive().nullable() })
          .safeParse(value);
        if (!parsed.success) throw new Error('No se pudo confirmar la extracción pendiente.');
        return parsed.data.withdrawalId;
      };
      const existing = await receipt();
      if (existing !== null) return parseOperationResult(operation, existing);
      try {
        return parseOperationResult(
          operation,
          await request(hostUrl, '/v1/operation', { operation, args, token }, hostPin),
        );
      } catch (error) {
        if (!(error instanceof HostRejection) || error.code !== 'REJECTED') throw error;
        const confirmed = await receipt();
        if (confirmed !== null) return parseOperationResult(operation, confirmed);
        throw new HostRejection(error.message, 'NOT_COMMITTED');
      }
    }
    if (!mutationOperations.has(operation))
      return parseOperationResult(
        operation,
        await request(hostUrl, '/v1/operation', { operation, args, token }),
      );
    const { hostPin } = await loadNetworkConfig();
    const pending = await prepareOperation({
      hostUrl,
      username,
      clientId,
      operation,
      args,
      ...(hostPin ? { hostPin } : {}),
    });
    return resolvePendingOperation(hostUrl, pending, token, (value) =>
      parseOperationResult(operation, value),
    );
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
    public readonly code: 'AUTH_EXPIRED' | 'REJECTED' | 'NOT_COMMITTED',
  ) {
    super(message);
  }
}

async function request(
  hostUrl: string,
  path: string,
  body: object,
  pin?: string,
): Promise<unknown> {
  const result: unknown = JSON.parse(await pinnedRequest(hostUrl, path, body, pin));
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
    if (
      confirmed.code === 'AUTH_EXPIRED' &&
      'token' in body &&
      typeof body.token === 'string' &&
      (await clearNetworkToken(body.token))
    ) {
      replicaSessionGeneration += 1;
      await clearNetworkReplicas();
    }
    throw new HostRejection(
      confirmed.error,
      confirmed.code === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'REJECTED',
    );
  }
  if (confirmed.data === undefined)
    throw new Error('No se pudo confirmar la respuesta del administrador.');
  return confirmed.data;
}

let authenticationQueue: Promise<unknown> = Promise.resolve();
function withAuthentication<T>(action: () => Promise<T>): Promise<T> {
  const running = authenticationQueue.then(action);
  authenticationQueue = running.catch(() => undefined);
  return running;
}

export function loginToHost(hostUrl: string, username: string, password: string) {
  return withAuthentication(async () => {
    await flushRevocations(hostUrl);
    const session = networkSessionSchema.parse(
      await request(hostUrl, '/v1/login', { username, password }),
    );
    await saveNetworkToken(session.token);
    const pending = await getPendingOperation();
    if (pending && pending.hostUrl === hostUrl && pending.username === session.user.username) {
      await resolvePendingOperation(hostUrl, pending, session.token, (value) =>
        parseOperationResult(pending.operation, value),
      );
    }
    return session.user;
  });
}

export function logoutFromHost(hostUrl?: string, hostPin?: string) {
  return withAuthentication(async () => {
    const token = await getNetworkToken();
    const config = await loadNetworkConfig();
    replicaSessionGeneration += 1;
    await clearNetworkToken();
    await clearNetworkReplicas();
    if (hostUrl && token) await revokeOrDefer(hostUrl, hostPin ?? config.hostPin ?? '', token);
  });
}

const snapshotRequests = new Map<string, Promise<NetworkSnapshot>>();
let replicaSessionGeneration = 0;
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
  const generation = replicaSessionGeneration;
  const assertCurrentSession = async () => {
    if (generation !== replicaSessionGeneration || (await getNetworkToken()) !== token)
      throw new HostRejection('La sesión cambió. Vuelve a iniciar sesión.', 'AUTH_EXPIRED');
  };
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
    const response = await request(hostUrl, '/v1/snapshot', {
      token,
      ...(cached?.authorityId
        ? { knownRevision: cached.revision, authorityId: cached.authorityId }
        : {}),
    });
    await assertCurrentSession();
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
    try {
      await assertCurrentSession();
    } catch (error) {
      await clearNetworkReplicas();
      throw error;
    }
    return snapshot;
  })().finally(() => snapshotRequests.delete(cacheKey));
  snapshotRequests.set(cacheKey, pending);
  return pending;
}

export async function registerHostSale(
  hostUrl: string,
  input: Omit<NetworkSaleCommand, 'token'>,
  hostPin?: string,
): Promise<number> {
  const token = await getNetworkToken();
  if (!token)
    throw new HostRejection(
      'Inicia sesión nuevamente en el teléfono administrador.',
      'AUTH_EXPIRED',
    );
  const receipt = async () => {
    const parsed = z
      .object({ saleId: z.number().int().positive().nullable() })
      .safeParse(await request(hostUrl, '/v1/sale-receipt', { ...input, token }, hostPin));
    if (!parsed.success) throw new Error('No se pudo confirmar la venta pendiente.');
    return parsed.data.saleId;
  };
  const previous = await receipt();
  if (previous !== null) return previous;
  let result: unknown;
  try {
    result = await request(hostUrl, '/v1/sale', { ...input, token }, hostPin);
  } catch (error) {
    if (!(error instanceof HostRejection) || error.code !== 'REJECTED') throw error;
    const confirmed = await receipt();
    if (confirmed !== null) return confirmed;
    throw new HostRejection(error.message, 'NOT_COMMITTED');
  }
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
  return dailyReportSchema.parse(await request(hostUrl, '/v1/report', { token }));
}

export type HostSessionState = SesionCaja | null;
export type HostSalePayment = Payment;
export type HostSaleMethod = SaleMethod;
