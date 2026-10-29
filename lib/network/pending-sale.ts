import { createPendingStore } from '@/lib/network/pending-store';
import { assertSaleCommand } from '@/lib/network/validation';
import * as Crypto from 'expo-crypto';
import { HostRejection, registerHostSale } from '@/lib/network/client';
import type { NetworkConfig, NetworkSaleCommand } from '@/lib/network/types';

const KEY = 'mipypos.pendingLanSale.v2';
export interface PendingSale {
  hostUrl: string;
  username: string;
  command: Omit<NetworkSaleCommand, 'token'>;
}
function isPendingSale(value: unknown): value is PendingSale {
  if (typeof value !== 'object' || value === null) return false;
  if (!('hostUrl' in value) || typeof value.hostUrl !== 'string') return false;
  if (!('username' in value) || typeof value.username !== 'string') return false;
  if (!('command' in value) || typeof value.command !== 'object' || value.command === null)
    return false;
  const command = value.command;
  return (
    'commandId' in command &&
    typeof command.commandId === 'string' &&
    'clientId' in command &&
    typeof command.clientId === 'string' &&
    'method' in command &&
    (command.method === 'cash' || command.method === 'transfer' || command.method === 'mixed') &&
    'sessionId' in command &&
    typeof command.sessionId === 'number' &&
    'payments' in command &&
    Array.isArray(command.payments) &&
    command.payments.every(
      (payment: unknown) =>
        typeof payment === 'object' &&
        payment !== null &&
        'type' in payment &&
        (payment.type === 'cash' || payment.type === 'transfer') &&
        'amount' in payment &&
        typeof payment.amount === 'number',
    ) &&
    'items' in command &&
    Array.isArray(command.items) &&
    command.items.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'productId' in item &&
        typeof item.productId === 'number' &&
        'areaId' in item &&
        typeof item.areaId === 'number' &&
        'quantity' in item &&
        typeof item.quantity === 'number',
    )
  );
}
function parsePendingSale(stored: string): PendingSale {
  let pending: unknown;
  try {
    pending = JSON.parse(stored);
  } catch (error) {
    throw new Error('No se pudo leer la venta pendiente. El registro se conserva sin reenviarlo.', {
      cause: error,
    });
  }
  if (!isPendingSale(pending))
    throw new Error('El formato de la venta pendiente no es válido. El registro se conserva.');
  assertSaleCommand({ ...pending.command, token: 'validation' });
  return pending;
}
const store = createPendingStore(KEY, parsePendingSale);
export const getPendingSale = store.get;
export async function upgradePendingSaleTransport(hostUrl: string, verifiedPreviousHost?: string) {
  const pending = await getPendingSale();
  if (
    pending &&
    ((pending.hostUrl.startsWith('http:') &&
      pending.hostUrl.replace(/^http:/, 'https:') === hostUrl) ||
      pending.hostUrl === verifiedPreviousHost)
  )
    await store.set({ ...pending, hostUrl });
}
let sending = false;
let creating = false;
export async function sendPendingSale(config: NetworkConfig, username: string): Promise<number> {
  if (sending) throw new Error('La venta ya se está confirmando.');
  sending = true;
  try {
    const pending = await getPendingSale();
    if (!pending) throw new Error('No hay una venta pendiente.');
    if (
      pending.hostUrl !== config.hostUrl ||
      pending.command.clientId !== config.clientId ||
      pending.username !== username
    )
      throw new Error('Confirma la venta pendiente con el mismo usuario y administrador.');
    try {
      const id = await registerHostSale(pending.hostUrl, pending.command);
      await store.clear();
      return id;
    } catch (error) {
      // Only an identity-scoped, authoritative absence check can resolve a rejection.
      if (error instanceof HostRejection && error.code === 'NOT_COMMITTED') await store.clear();
      throw error;
    }
  } finally {
    sending = false;
  }
}
export async function createPendingSale(
  config: NetworkConfig,
  username: string,
  input: Omit<NetworkSaleCommand, 'token' | 'commandId' | 'clientId'>,
) {
  if (sending || creating) throw new Error('La venta ya se está confirmando.');
  creating = true;
  try {
    if (await getPendingSale()) throw new Error('Confirma primero la venta pendiente.');
    const pending: PendingSale = {
      hostUrl: config.hostUrl,
      username,
      command: { ...input, commandId: Crypto.randomUUID(), clientId: config.clientId },
    };
    await store.set(pending);
    return await sendPendingSale(config, username);
  } finally {
    creating = false;
  }
}
