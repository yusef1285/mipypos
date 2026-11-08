import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { createPendingStore } from '@/lib/network/pending-store';
import { HostRejection, registerHostSale } from '@/lib/network/client';
import { assertSaleCommand } from '@/lib/network/validation';
import { validateHostPin } from '@/lib/network/qr';
import type { NetworkConfig, NetworkSaleCommand } from '@/lib/network/types';

/**
 * Durable queue of terminal sales. A sale is first written here (encrypted
 * journal) and then sent to the administrator. If the Wi-Fi drops, the phone
 * keeps selling: every queued sale keeps its commandId, so a later sync is
 * idempotent (the host answers with the existing receipt instead of selling twice).
 */
export const OUTBOX_LIMIT = 300;
const KEY = 'mipypos.saleOutbox.v1';
const amount = z.number().finite();
const entrySchema = z
  .object({
    localNumber: z.number().int().positive(),
    createdAt: z.string().datetime(),
    hostUrl: z.string().min(1),
    hostPin: z.string().optional(),
    username: z.string().min(1).max(240),
    total: amount,
    lines: z.array(z.object({ name: z.string().max(500), price: amount })).max(1000),
    command: z.custom<Omit<NetworkSaleCommand, 'token'>>((value) => {
      try {
        if (typeof value !== 'object' || value === null) return false;
        assertSaleCommand({ ...value, token: 'validation' });
        return true;
      } catch {
        return false;
      }
    }),
    status: z.enum(['pending', 'rejected']),
    /** True once the host proved the command was never committed. */
    notCommitted: z.boolean().default(false),
    error: z.string().max(2000).optional(),
    attempts: z.number().int().nonnegative().default(0),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    nextNumber: z.number().int().positive(),
    entries: z.array(entrySchema).max(OUTBOX_LIMIT + 50),
    synced: z
      .array(
        z.object({
          localNumber: z.number().int().positive(),
          commandId: z.string(),
          saleId: z.number().int().positive(),
        }),
      )
      .max(50),
  })
  .strict();
export type OutboxSale = z.infer<typeof entrySchema>;
export type OutboxState = z.infer<typeof stateSchema>;
const empty = (): OutboxState => ({ version: 1, nextNumber: 1, entries: [], synced: [] });

function parseState(raw: string): OutboxState {
  const state = stateSchema.parse(JSON.parse(raw));
  for (const entry of state.entries) if (entry.hostPin) validateHostPin(entry.hostPin);
  return state;
}
const store = createPendingStore(KEY, parseState);

let queue: Promise<unknown> = Promise.resolve();
function locked<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action);
  queue = next.catch(() => undefined);
  return next;
}
const read = async () => (await store.get()) ?? empty();

export const getOutbox = () => locked(read);
export async function hasOutboxSales() {
  return (await getOutbox()).entries.length > 0;
}

/** Quantities already sold on this terminal but not yet confirmed by the host. */
export function outboxReservations(state: OutboxState, hostUrl: string) {
  const reserved = new Map<string, number>();
  for (const entry of state.entries)
    if (entry.status === 'pending' && entry.hostUrl === hostUrl)
      for (const item of entry.command.items) {
        const key = `${item.productId}:${item.areaId}`;
        reserved.set(key, (reserved.get(key) ?? 0) + item.quantity);
      }
  return reserved;
}

export function enqueueOutboxSale(
  config: NetworkConfig,
  username: string,
  input: Omit<NetworkSaleCommand, 'token' | 'commandId' | 'clientId'>,
  meta: { total: number; lines: Array<{ name: string; price: number }> },
  now = new Date(),
): Promise<OutboxSale> {
  return locked(async () => {
    if (config.mode !== 'client' || !config.hostUrl)
      throw new Error('Escanea el QR del administrador.');
    const state = await read();
    if (state.entries.length >= OUTBOX_LIMIT)
      throw new Error(
        `Hay ${OUTBOX_LIMIT} ventas sin sincronizar. Conéctate al administrador antes de seguir vendiendo.`,
      );
    const entry: OutboxSale = {
      localNumber: state.nextNumber,
      createdAt: now.toISOString(),
      hostUrl: config.hostUrl,
      ...(config.hostPin ? { hostPin: validateHostPin(config.hostPin) } : {}),
      username,
      total: meta.total,
      lines: meta.lines,
      command: { ...input, commandId: Crypto.randomUUID(), clientId: config.clientId },
      status: 'pending',
      notCommitted: false,
      attempts: 0,
    };
    entrySchema.parse(entry);
    await store.set({
      ...state,
      nextNumber: state.nextNumber + 1,
      entries: [...state.entries, entry],
    });
    return entry;
  });
}

export interface OutboxSyncResult {
  sent: Array<{ localNumber: number; commandId: string; saleId: number }>;
  rejected: OutboxSale[];
  remaining: number;
  /** The host could not be reached; remaining sales stay queued. */
  offline: boolean;
  authExpired: boolean;
  error?: string;
}

/** Sends queued sales in order. Never drops a sale the host may have committed. */
export function syncOutbox(config: NetworkConfig, username: string): Promise<OutboxSyncResult> {
  return locked(async () => {
    const result: OutboxSyncResult = {
      sent: [],
      rejected: [],
      remaining: 0,
      offline: false,
      authExpired: false,
    };
    let state = await read();
    for (const original of state.entries) {
      if (
        original.status !== 'pending' ||
        original.username !== username ||
        original.hostUrl !== config.hostUrl ||
        original.command.clientId !== config.clientId ||
        (original.hostPin !== undefined && original.hostPin !== config.hostPin)
      )
        continue;
      try {
        const saleId = await registerHostSale(original.hostUrl, original.command, original.hostPin);
        const record = {
          localNumber: original.localNumber,
          commandId: original.command.commandId,
          saleId,
        };
        result.sent.push(record);
        state = {
          ...state,
          entries: state.entries.filter(
            (entry) => entry.command.commandId !== original.command.commandId,
          ),
          synced: [...state.synced, record].slice(-50),
        };
        await store.set(state);
      } catch (error) {
        if (error instanceof HostRejection && error.code === 'AUTH_EXPIRED') {
          result.authExpired = true;
          result.error = error.message;
          break;
        }
        if (error instanceof HostRejection) {
          const rejected: OutboxSale = {
            ...original,
            status: 'rejected',
            notCommitted: error.code === 'NOT_COMMITTED',
            error: error.message,
            attempts: original.attempts + 1,
          };
          result.rejected.push(rejected);
          state = {
            ...state,
            entries: state.entries.map((entry) =>
              entry.command.commandId === original.command.commandId ? rejected : entry,
            ),
          };
          await store.set(state);
          continue;
        }
        // Network failure: stop here so later sales keep their original order.
        result.offline = true;
        result.error =
          error instanceof Error ? error.message : 'No se pudo conectar con el administrador.';
        break;
      }
    }
    result.remaining = state.entries.length;
    return result;
  });
}

/** Re-queues a rejected sale. A proven non-committed sale gets a new identity and cash shift. */
export function retryOutboxSale(commandId: string, sessionId?: number) {
  return locked(async () => {
    const state = await read();
    const entry = state.entries.find((item) => item.command.commandId === commandId);
    if (!entry || entry.status !== 'rejected') throw new Error('La venta ya no está rechazada.');
    const next: OutboxSale = {
      ...entry,
      status: 'pending',
      error: undefined,
      command: entry.notCommitted
        ? {
            ...entry.command,
            commandId: Crypto.randomUUID(),
            ...(sessionId ? { sessionId } : {}),
          }
        : entry.command,
      notCommitted: false,
    };
    await store.set({
      ...state,
      entries: state.entries.map((item) => (item.command.commandId === commandId ? next : item)),
    });
    return next;
  });
}

/** Only a sale the host proved it never committed may be discarded. */
export function discardOutboxSale(commandId: string) {
  return locked(async () => {
    const state = await read();
    const entry = state.entries.find((item) => item.command.commandId === commandId);
    if (!entry) return;
    if (entry.status !== 'rejected' || !entry.notCommitted)
      throw new Error(
        'Esta venta todavía puede estar registrada en el administrador. Sincroniza antes de descartarla.',
      );
    await store.set({
      ...state,
      entries: state.entries.filter((item) => item.command.commandId !== commandId),
    });
  });
}

/** After a DHCP change the same pinned administrator may appear on a new address. */
export function rebindOutbox(hostUrl: string, hostPin: string) {
  return locked(async () => {
    const state = await read();
    if (!state.entries.some((entry) => entry.hostPin === hostPin && entry.hostUrl !== hostUrl))
      return;
    await store.set({
      ...state,
      entries: state.entries.map((entry) =>
        entry.hostPin === hostPin ? { ...entry, hostUrl } : entry,
      ),
    });
  });
}

/** Outbox records that bind this terminal to its original administrator. */
export async function outboxAuthorities() {
  const state = await getOutbox();
  return state.entries.map((entry) => ({ hostUrl: entry.hostUrl, hostPin: entry.hostPin }));
}
