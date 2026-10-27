import * as Crypto from 'expo-crypto';
import { getSecret, setSecret, removeSecret } from '@/lib/network/secure-storage';
import type { OperationRequest, PosOperation } from '@/lib/network/operations';
import { assertOperationRequest } from '@/lib/network/validation';

const KEY = 'mipypos.pending-operation';
export interface PendingOperation {
  hostUrl: string;
  username: string;
  clientId: string;
  commandId: string;
  operation: PosOperation;
  args: OperationRequest['args'];
  fingerprint: string;
}
export async function getPendingOperation(): Promise<PendingOperation | null> {
  const stored = await getSecret(KEY);
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (
      !value ||
      typeof value !== 'object' ||
      !('hostUrl' in value) ||
      typeof value.hostUrl !== 'string' ||
      !('username' in value) ||
      typeof value.username !== 'string' ||
      !('clientId' in value) ||
      typeof value.clientId !== 'string' ||
      !('commandId' in value) ||
      typeof value.commandId !== 'string' ||
      !('fingerprint' in value) ||
      typeof value.fingerprint !== 'string'
    )
      throw new Error('Formato no válido');
    // Operation validation keeps old persisted records compatible without
    // silently discarding an operation whose commit may already have happened.
    if (!('operation' in value) || !('args' in value)) throw new Error('Formato no válido');
    const request = { ...value, token: 'validation' };
    assertOperationRequest(request);
    return {
      hostUrl: value.hostUrl,
      username: value.username,
      clientId: value.clientId,
      commandId: value.commandId,
      fingerprint: value.fingerprint,
      operation: request.operation,
      args: request.args,
    };
  } catch (error) {
    throw new Error(
      'No se pudo leer la operación pendiente. Se conserva sin reenviarla; no cambies de administrador hasta revisar su confirmación.',
      { cause: error },
    );
  }
}
export async function operationFingerprint(operation: string, args: unknown): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify([operation, args]),
  );
}
export async function prepareOperation(input: Omit<PendingOperation, 'commandId' | 'fingerprint'>) {
  const fingerprint = await operationFingerprint(input.operation, input.args);
  const pending = await getPendingOperation();
  if (pending) {
    if (
      pending.hostUrl !== input.hostUrl ||
      pending.username !== input.username ||
      pending.clientId !== input.clientId ||
      pending.fingerprint !== fingerprint
    )
      throw new Error(
        'Hay una operación pendiente. Vuelve a iniciar sesión con el mismo usuario para confirmar su resultado.',
      );
    return pending;
  }
  const next = { ...input, commandId: Crypto.randomUUID(), fingerprint };
  await setSecret(KEY, JSON.stringify(next));
  return next;
}
export async function rebindPendingOperation(verifiedPreviousHost: string, hostUrl: string) {
  const pending = await getPendingOperation();
  if (pending?.hostUrl === verifiedPreviousHost)
    await setSecret(KEY, JSON.stringify({ ...pending, hostUrl }));
}
export const clearPendingOperation = () => removeSecret(KEY);
